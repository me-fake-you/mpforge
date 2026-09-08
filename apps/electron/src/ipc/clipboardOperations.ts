export function createClipboardOperations<T>(
  clipboard: {
    write(items: T[]): Promise<void>;
    writeText(text: string): Promise<void>;
  },
  createItem: (data: Record<string, string>) => T,
) {
  return {
    async writeHTML(payload: { html?: string; text?: string }) {
      const html = payload?.html ?? "";
      const text = payload?.text ?? "";
      if (!html.trim()) return { success: false, error: "HTML 不能为空" };
      try {
        await clipboard.write([
          createItem({ "text/html": html, "text/plain": text }),
        ]);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "写入剪贴板失败",
        };
      }
    },
    async writeText(text: string) {
      if (!text?.trim()) return { success: false, error: "文本不能为空" };
      try {
        await clipboard.writeText(text);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "写入剪贴板失败",
        };
      }
    },
  };
}
