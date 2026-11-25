#!/usr/bin/env python3
"""
HDM libtorrent-rasterbar sidecar daemon.
Provides qBittorrent-equivalent BitTorrent performance (libtorrent 2.x, TCP + uTP,
MSE/PE encryption, DHT/PEX/LSD, UPnP/NAT-PMP, fast-resume, force recheck, sequential
download, per-torrent caps, live tracker re-announce) over a localhost-only JSON API.
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import libtorrent as lt

TOP_PUBLIC_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "https://tracker.tamersunion.org:443/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://p4p.arenabg.com:1337/announce",
    "udp://tracker.moeking.me:6969/announce",
    "udp://retracker.lanta.me:2710/announce",
    "udp://tracker.srv00.com:6969/announce",
    "udp://tracker.filemail.com:6969/announce",
    "udp://tracker1.bt.moack.co.kr:80/announce",
    "udp://tracker.theoks.net:6969/announce",
    "udp://opentracker.io:6969/announce",
    "udp://movies.zsw.ca:6969/announce",
    "http://tracker.openbittorrent.com:80/announce",
]


def info_hash_hex(handle_or_ti: Any) -> str:
    try:
        ih = handle_or_ti.info_hashes()
        if ih.has_v1():
            return str(ih.v1).lower()
        return str(ih.get_best()).lower()
    except Exception:
        return str(handle_or_ti.info_hash()).lower()


def meta_from_torrent_info(ti: lt.torrent_info, ih_hex: str | None = None) -> dict[str, Any]:
    fs = ti.files()
    files = []
    for idx in range(fs.num_files()):
        files.append(
            {
                "index": idx,
                "path": fs.file_path(idx).replace("\\", "/"),
                "size": int(fs.file_size(idx)),
            }
        )
    return {
        "infoHash": (ih_hex or info_hash_hex(ti)).lower(),
        "name": ti.name() or "torrent",
        "totalSize": int(ti.total_size()),
        "files": files,
    }


def is_pid_alive(pid: int) -> bool:
    if pid <= 0:
        return True
    if sys.platform == "win32":
        SYNCHRONIZE = 0x00100000
        handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if not handle:
            return False
        try:
            WAIT_TIMEOUT = 0x00000102
            res = ctypes.windll.kernel32.WaitForSingleObject(handle, 0)
            return res == WAIT_TIMEOUT
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


class TorrentService:
    def __init__(self, state_dir: Path, default_output: Path) -> None:
        self.state_dir = state_dir
        self.default_output = default_output
        self.resume_dir = state_dir / "fastresume"
        self.resume_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.handles: dict[str, lt.torrent_handle] = {}
        self.meta_cache: dict[str, dict[str, Any]] = {}
        self.shutting_down = False

        settings: dict[str, Any] = {
            "user_agent": "HDM/0.1.0 (libtorrent)",
            "listen_interfaces": "0.0.0.0:0,[::]:0",
            "enable_dht": True,
            "dht_bootstrap_nodes": (
                "dht.libtorrent.org:25401,"
                "router.bittorrent.com:6881,"
                "router.utorrent.com:6881,"
                "dht.transmissionbt.com:6881"
            ),
            "enable_lsd": True,
            "enable_upnp": True,
            "enable_natpmp": True,
            "enable_incoming_tcp": True,
            "enable_outgoing_tcp": True,
            "enable_incoming_utp": True,
            "enable_outgoing_utp": True,
            # 0 = prefer_tcp (qBittorrent default: prevents uTP from throttling TCP peers)
            "mixed_mode_algorithm": 0,
            # MSE/PE protocol encryption: 1 = enabled, level 3 = plaintext + rc4, prefer rc4
            "in_enc_policy": 1,
            "out_enc_policy": 1,
            "allowed_enc_level": 3,
            "prefer_rc4": True,
            "connections_limit": 500,
            "unchoke_slots_limit": 20,
            "active_downloads": 16,
            "active_seeds": 8,
            "active_limit": 32,
            "aio_threads": 8,
            "checking_mem_usage": 256,
            "send_buffer_watermark": 4 * 1024 * 1024,
            "send_buffer_low_watermark": 1024 * 1024,
            "request_timeout": 15,
            "peer_connect_timeout": 7,
            "max_out_request_queue": 1500,
            "max_allowed_in_request_queue": 1000,
            "announce_to_all_trackers": True,
            "announce_to_all_tiers": True,
            "stop_tracker_timeout": 2,
            "alert_mask": (
                lt.alert.category_t.status_notification
                | lt.alert.category_t.storage_notification
                | lt.alert.category_t.error_notification
            ),
        }
        self.session = lt.session(settings)

        self.alert_thread = threading.Thread(target=self._alert_loop, daemon=True)
        self.alert_thread.start()

    def _alert_loop(self) -> None:
        while not self.shutting_down:
            try:
                if self.session.wait_for_alert(500) is not None:
                    for alert in self.session.pop_alerts():
                        if isinstance(alert, lt.save_resume_data_alert):
                            ih = info_hash_hex(alert.handle)
                            try:
                                buf = lt.write_resume_data_buf(alert.params)
                                (self.resume_dir / f"{ih}.fastresume").write_bytes(buf)
                            except Exception:
                                pass
            except Exception:
                time.sleep(0.25)

    def _add_trackers(self, handle: lt.torrent_handle, extra: list[str]) -> None:
        existing = {t.get("url", "") for t in handle.trackers()}
        tier = 0
        for url in [*TOP_PUBLIC_TRACKERS, *extra]:
            u = url.strip()
            if u and u not in existing:
                try:
                    handle.add_tracker({"url": u, "tier": tier})
                    existing.add(u)
                except Exception:
                    pass

    def inspect(self, req: dict[str, Any]) -> dict[str, Any]:
        if req.get("fileB64"):
            raw = base64.b64decode(req["fileB64"])
            ti = lt.torrent_info(lt.bdecode(raw))
            return meta_from_torrent_info(ti)

        url = str(req.get("url", "")).strip()
        if not url:
            raise ValueError("missing torrent source")

        if not url.lower().startswith("magnet:"):
            with urllib.request.urlopen(url, timeout=20) as resp:
                raw = resp.read()
            ti = lt.torrent_info(lt.bdecode(raw))
            return meta_from_torrent_info(ti)

        params = lt.parse_magnet_uri(url)
        target_ih = info_hash_hex(params)
        with self.lock:
            if target_ih in self.meta_cache:
                return self.meta_cache[target_ih]
            existing = self.handles.get(target_ih)
            if existing and existing.is_valid():
                st = existing.status()
                if st.has_metadata:
                    ti = existing.torrent_file()
                    if ti is not None:
                        meta = meta_from_torrent_info(ti, target_ih)
                        self.meta_cache[target_ih] = meta
                        return meta

        tmp_dir = Path(tempfile.mkdtemp(prefix="hdm-lt-meta-"))
        params.save_path = str(tmp_dir)
        params.flags |= lt.torrent_flags.upload_mode
        params.flags &= ~lt.torrent_flags.auto_managed
        params.flags &= ~lt.torrent_flags.paused
        params.trackers = list(dict.fromkeys([*list(params.trackers), *TOP_PUBLIC_TRACKERS]))

        handle = self.session.add_torrent(params)
        try:
            deadline = time.monotonic() + 35.0
            while time.monotonic() < deadline:
                st = handle.status()
                if st.has_metadata:
                    ti = handle.torrent_file()
                    if ti is not None:
                        meta = meta_from_torrent_info(ti, info_hash_hex(handle))
                        with self.lock:
                            self.meta_cache[meta["infoHash"]] = meta
                        return meta
                time.sleep(0.2)
            raise TimeoutError("Timed out resolving magnet metadata (no peers responded)")
        finally:
            try:
                self.session.remove_torrent(handle, lt.session.delete_files)
            except Exception:
                pass
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def add(self, req: dict[str, Any]) -> dict[str, Any]:
        save_dir = Path(req.get("saveDir") or str(self.default_output))
        save_dir.mkdir(parents=True, exist_ok=True)
        paused = bool(req.get("paused", False))
        force_recheck = bool(req.get("forceRecheck", False))
        sequential = bool(req.get("sequential", False))
        only_files = req.get("onlyFiles")
        extra_trackers = [str(t) for t in (req.get("extraTrackers") or [])]
        max_dl_bps = int(req.get("maxDlBps") or 0)
        max_ul_bps = int(req.get("maxUlBps") or 0)

        if req.get("fileB64"):
            raw = base64.b64decode(req["fileB64"])
            ti = lt.torrent_info(lt.bdecode(raw))
            ih = info_hash_hex(ti)
            params = lt.add_torrent_params()
            params.ti = ti
        else:
            url = str(req.get("url", "")).strip()
            if not url:
                raise ValueError("missing torrent source")
            if url.lower().startswith("magnet:"):
                params = lt.parse_magnet_uri(url)
                ih = info_hash_hex(params)
            else:
                with urllib.request.urlopen(url, timeout=20) as resp:
                    raw = resp.read()
                ti = lt.torrent_info(lt.bdecode(raw))
                ih = info_hash_hex(ti)
                params = lt.add_torrent_params()
                params.ti = ti

        # Load fast-resume data if present and not force-rechecking.
        resume_file = self.resume_dir / f"{ih}.fastresume"
        if not force_recheck and resume_file.is_file():
            try:
                loaded = lt.read_resume_data(resume_file.read_bytes())
                if params.ti is not None:
                    loaded.ti = params.ti
                params = loaded
            except Exception:
                pass

        params.save_path = str(save_dir)
        params.flags &= ~lt.torrent_flags.auto_managed
        if paused:
            params.flags |= lt.torrent_flags.paused
        else:
            params.flags &= ~lt.torrent_flags.paused
        if sequential:
            params.flags |= lt.torrent_flags.sequential_download
        else:
            params.flags &= ~lt.torrent_flags.sequential_download

        merged_trackers = list(
            dict.fromkeys([*list(params.trackers), *TOP_PUBLIC_TRACKERS, *extra_trackers])
        )
        params.trackers = merged_trackers

        with self.lock:
            existing = self.handles.get(ih)
            if existing and existing.is_valid():
                handle = existing
            else:
                handle = self.session.add_torrent(params)
                self.handles[ih] = handle

        if only_files is not None and handle.status().has_metadata:
            ti = handle.torrent_file()
            if ti is not None:
                wanted = set(int(i) for i in only_files)
                prios = [4 if idx in wanted else 0 for idx in range(ti.num_files())]
                handle.prioritize_files(prios)

        self._add_trackers(handle, extra_trackers)
        handle.set_sequential_download(sequential)
        handle.set_download_limit(max_dl_bps if max_dl_bps > 0 else -1)
        handle.set_upload_limit(max_ul_bps if max_ul_bps > 0 else -1)

        if force_recheck:
            handle.force_recheck()
        if paused:
            handle.pause()
        else:
            handle.resume()
            handle.force_reannounce()

        return {"infoHash": ih}

    def status_all(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        with self.lock:
            items = list(self.handles.items())
        for ih, h in items:
            if not h.is_valid():
                continue
            st = h.status()
            state_enum = st.state
            is_paused = bool(st.flags & lt.torrent_flags.paused)
            err_msg = st.errc.message() if st.errc and st.errc.value() != 0 else None

            meta = None
            if st.has_metadata:
                with self.lock:
                    meta = self.meta_cache.get(ih)
                if meta is None:
                    ti = h.torrent_file()
                    if ti is not None:
                        meta = meta_from_torrent_info(ti, ih)
                        with self.lock:
                            self.meta_cache[ih] = meta

            checking_states = (
                lt.torrent_status.checking_files,
                lt.torrent_status.downloading_metadata,
                lt.torrent_status.checking_resume_data,
            )
            total = int(st.total_wanted)
            done = int(st.total_wanted_done)
            dl_rate = int(st.download_payload_rate)
            ul_rate = int(st.upload_payload_rate)
            finished = bool(
                st.has_metadata
                and state_enum not in checking_states
                and (st.is_seeding or (total > 0 and done >= total))
            )

            if err_msg:
                state_str = "error"
            elif is_paused:
                state_str = "paused"
            elif state_enum in checking_states or not st.has_metadata:
                state_str = "initializing"
            elif finished:
                state_str = "seeding"
            else:
                state_str = "downloading"

            remaining = max(0, total - done)
            eta_secs = int(remaining // dl_rate) if (dl_rate > 0 and not finished and total > 0) else None

            out[ih] = {
                "state": state_str,
                "downloaded": done,
                "uploaded": int(st.total_upload),
                "total": total,
                "downloadSpeed": dl_rate,
                "uploadSpeed": ul_rate,
                "peers": int(st.num_peers),
                "seeds": int(st.num_seeds),
                "etaSecs": eta_secs,
                "finished": finished,
                "error": err_msg,
                "name": st.name or (meta["name"] if meta else None),
                "meta": meta,
            }
        return out

    def pause(self, ih: str) -> None:
        key = ih.lower()
        with self.lock:
            h = self.handles.get(key)
        if h and h.is_valid():
            h.unset_flags(lt.torrent_flags.auto_managed)
            h.pause()
            if h.status().has_metadata:
                try:
                    h.save_resume_data()
                except Exception:
                    pass

    def resume(self, ih: str) -> None:
        key = ih.lower()
        with self.lock:
            h = self.handles.get(key)
        if not h or not h.is_valid():
            raise KeyError("unknown torrent")
        h.unset_flags(lt.torrent_flags.auto_managed)
        h.resume()
        h.force_reannounce()

    def recheck(self, ih: str) -> None:
        key = ih.lower()
        with self.lock:
            h = self.handles.get(key)
        if not h or not h.is_valid():
            raise KeyError("unknown torrent")
        h.force_recheck()
        h.resume()

    def set_options(self, req: dict[str, Any]) -> None:
        key = str(req.get("infoHash", "")).lower()
        with self.lock:
            h = self.handles.get(key)
        if not h or not h.is_valid():
            return
        if req.get("sequential") is not None:
            h.set_sequential_download(bool(req["sequential"]))
        if req.get("extraTrackers") is not None:
            self._add_trackers(h, [str(t) for t in req["extraTrackers"]])
            h.force_reannounce()
        if req.get("maxDlBps") is not None:
            dl = int(req["maxDlBps"])
            h.set_download_limit(dl if dl > 0 else -1)
        if req.get("maxUlBps") is not None:
            ul = int(req["maxUlBps"])
            h.set_upload_limit(ul if ul > 0 else -1)

    def remove(self, ih: str, delete_files: bool) -> None:
        key = ih.lower()
        with self.lock:
            h = self.handles.pop(key, None)
            self.meta_cache.pop(key, None)
        if h and h.is_valid():
            flags = lt.session.delete_files if delete_files else 0
            self.session.remove_torrent(h, flags)
        resume_file = self.resume_dir / f"{key}.fastresume"
        if resume_file.exists():
            try:
                resume_file.unlink()
            except Exception:
                pass

    def set_limits(self, download_bps: int, upload_bps: int) -> None:
        self.session.apply_settings(
            {
                "download_rate_limit": download_bps if download_bps > 0 else 0,
                "upload_rate_limit": upload_bps if upload_bps > 0 else 0,
            }
        )

    def save_all_resume(self) -> None:
        with self.lock:
            handles = [h for h in self.handles.values() if h.is_valid() and h.status().has_metadata]
        for h in handles:
            try:
                h.save_resume_data()
            except Exception:
                pass
        if handles:
            time.sleep(0.5)

    def shutdown(self) -> None:
        self.shutting_down = True
        self.save_all_resume()


def make_handler(service: TorrentService, secret: str, shutdown_event: threading.Event):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            return

        def _send(self, code: int, payload: Any) -> None:
            raw = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _check_auth(self) -> bool:
            if self.headers.get("X-HDM-Token") != secret:
                self._send(403, {"error": "forbidden"})
                return False
            return True

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                return {}
            body = self.rfile.read(length)
            return json.loads(body.decode("utf-8"))

        def do_GET(self) -> None:
            if not self._check_auth():
                return
            try:
                if self.path == "/health":
                    self._send(200, {"ok": True, "version": lt.__version__})
                elif self.path == "/status":
                    self._send(200, service.status_all())
                else:
                    self._send(404, {"error": "not found"})
            except Exception as e:
                self._send(500, {"error": str(e)})

        def do_POST(self) -> None:
            if not self._check_auth():
                return
            try:
                data = self._read_json()
                if self.path == "/inspect":
                    self._send(200, service.inspect(data))
                elif self.path == "/add":
                    self._send(200, service.add(data))
                elif self.path == "/pause":
                    service.pause(str(data.get("infoHash", "")))
                    self._send(200, {"ok": True})
                elif self.path == "/resume":
                    service.resume(str(data.get("infoHash", "")))
                    self._send(200, {"ok": True})
                elif self.path == "/recheck":
                    service.recheck(str(data.get("infoHash", "")))
                    self._send(200, {"ok": True})
                elif self.path == "/options":
                    service.set_options(data)
                    self._send(200, {"ok": True})
                elif self.path == "/remove":
                    service.remove(str(data.get("infoHash", "")), bool(data.get("deleteFiles", False)))
                    self._send(200, {"ok": True})
                elif self.path == "/limits":
                    service.set_limits(int(data.get("downloadBps", 0)), int(data.get("uploadBps", 0)))
                    self._send(200, {"ok": True})
                elif self.path == "/shutdown":
                    self._send(200, {"ok": True})
                    shutdown_event.set()
                else:
                    self._send(404, {"error": "not found"})
            except Exception as e:
                self._send(500, {"error": str(e)})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--secret", type=str, required=True)
    parser.add_argument("--state-dir", type=str, required=True)
    parser.add_argument("--default-dir", type=str, required=True)
    parser.add_argument("--parent-pid", type=int, default=0)
    args = parser.parse_args()

    service = TorrentService(Path(args.state_dir), Path(args.default_dir))
    shutdown_event = threading.Event()
    server = ThreadingHTTPServer(
        ("127.0.0.1", args.port),
        make_handler(service, args.secret, shutdown_event),
    )
    server.daemon_threads = True

    def watchdog() -> None:
        while not shutdown_event.is_set():
            if args.parent_pid > 0 and not is_pid_alive(args.parent_pid):
                shutdown_event.set()
                break
            shutdown_event.wait(2.0)
        service.shutdown()
        server.shutdown()

    threading.Thread(target=watchdog, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        service.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
