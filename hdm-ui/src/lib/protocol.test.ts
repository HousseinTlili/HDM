import { describe, expect, it } from "vitest";
import { detectProtocol, isVideoPageUrl } from "./protocol";

describe("protocol auto-detection", () => {
  it("routes direct HTTP/FTP links to direct tab", () => {
    expect(detectProtocol("")).toBe("direct");
    expect(detectProtocol("https://mirror.rackspace.com/archlinux/arch.iso")).toBe(
      "direct"
    );
    expect(detectProtocol("ftp://ftp.example.org/pub/archive.tar.gz")).toBe(
      "direct"
    );
  });

  it("distinguishes Hugging Face repo URLs/shorthand from direct LFS /resolve/ URLs", () => {
    expect(
      detectProtocol(
        "https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct-GGUF/resolve/main/Llama-3.3-70B-Instruct-Q4_K_M.gguf"
      )
    ).toBe("direct");

    expect(detectProtocol("https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct-GGUF")).toBe(
      "huggingface"
    );
    expect(
      detectProtocol("https://hf.co/datasets/owner/dataset-name/tree/main")
    ).toBe("huggingface");
    expect(
      detectProtocol(
        "https://custom-hf.local/owner/model-name",
        "https://custom-hf.local"
      )
    ).toBe("huggingface");
    expect(detectProtocol("Qwen/Qwen2.5-Coder-32B-Instruct-GGUF")).toBe(
      "huggingface"
    );
    expect(detectProtocol("datasets/openwebtext/sample")).toBe("huggingface");
    expect(detectProtocol("api/models")).toBe("direct");
  });

  it("routes magnet links and .torrent files/URLs to torrent tab", () => {
    expect(
      detectProtocol("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567")
    ).toBe("torrent");
    expect(
      detectProtocol("https://releases.ubuntu.com/26.04/ubuntu.iso.torrent?mirror=1")
    ).toBe("torrent");
    expect(detectProtocol("C:\\Users\\Houssein\\Downloads\\fedora.torrent")).toBe(
      "torrent"
    );
  });

  it("routes supported video pages to video tab", () => {
    expect(detectProtocol("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "video"
    );
    expect(detectProtocol("https://youtu.be/dQw4w9WgXcQ")).toBe("video");
    expect(detectProtocol("https://vimeo.com/123456789")).toBe("video");
    expect(detectProtocol("https://www.twitch.tv/videos/987654")).toBe("video");
    expect(detectProtocol("https://www.tiktok.com/@user/video/123456")).toBe(
      "video"
    );
    expect(detectProtocol("https://x.com/rustlang/status/123456")).toBe("video");
    expect(isVideoPageUrl("https://example.com/status/123456")).toBe(false);
  });

  it("routes Ollama library URLs and ollama: references to ollama tab", () => {
    expect(detectProtocol("https://ollama.com/library/llama3.2")).toBe("ollama");
    expect(detectProtocol("https://ollama.com/library/qwen2.5-coder:14b")).toBe(
      "ollama"
    );
    expect(detectProtocol("ollama:deepseek-r1:7b")).toBe("ollama");
  });
});
