import { describe, expect, it, vi } from "vitest";

vi.mock("vinext/server/app-router-entry", () => ({
  default: { fetch: vi.fn(async () => new Response("application")) },
}));

vi.mock("vinext/server/image-optimization", () => ({
  DEFAULT_DEVICE_SIZES: [640],
  DEFAULT_IMAGE_SIZES: [32],
  handleImageOptimization: vi.fn(async (
    _request: Request,
    options: {
      fetchAsset: (path: string) => Promise<Response>;
      transformImage: (body: ReadableStream, options: { width: number; format: string; quality: number }) => Promise<Response>;
    },
  ) => {
    await options.fetchAsset("/sample.png");
    await options.transformImage(new ReadableStream(), { width: 640, format: "webp", quality: 80 });
    return new Response("optimized");
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

import RootLayout from "../app/layout";
import Home from "../app/page";
import worker from "../worker/index";

describe("runtime boundaries", () => {
  it("composes the repository snapshot into the console page", async () => {
    const page = await Home();

    expect(page.props.snapshot.tenants).toHaveLength(4);
  });

  it("provides the document shell used by the runtime", () => {
    const layout = RootLayout({ children: <main>Content</main> });

    expect(layout.type).toBe("html");
    expect(layout.props.children.props.className).toContain("font-sans");
  });

  it("dispatches application requests through the vinext handler", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/"),
      runtimeEnvironment(),
      runtimeContext(),
    );

    await expect(response.text()).resolves.toBe("application");
  });

  it("keeps image optimization behind the worker adapter", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/_vinext/image"),
      runtimeEnvironment(),
      runtimeContext(),
    );

    await expect(response.text()).resolves.toBe("optimized");
  });
});

function runtimeEnvironment() {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
    IMAGES: {
      input: vi.fn(() => ({
        transform: vi.fn(() => ({
          output: vi.fn(async () => ({ response: () => new Response("image") })),
        })),
      })),
    },
  } as unknown as Parameters<typeof worker.fetch>[1];
}

function runtimeContext() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as Parameters<typeof worker.fetch>[2];
}
