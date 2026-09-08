import assert from "node:assert/strict";
import test from "node:test";
import { createClipboardOperations } from "./clipboardOperations";

test("HTML and text are passed atomically through one MIME-keyed ClipboardItem", async () => {
  class Item {
    constructor(readonly data: Record<string, string>) {}
  }
  let written: Item[] = [];
  const operations = createClipboardOperations(
    {
      write: async (items: Item[]) => {
        written = items;
      },
      writeText: async () => {},
    },
    (data) => new Item(data),
  );
  assert.deepEqual(
    await operations.writeHTML({ html: "<b>Hello</b>", text: "Hello" }),
    { success: true },
  );
  assert.equal(written.length, 1);
  assert.ok(written[0] instanceof Item);
  assert.deepEqual(written[0].data, {
    "text/html": "<b>Hello</b>",
    "text/plain": "Hello",
  });
});

for (const kind of ["html", "text"] as const) {
  test(`${kind} clipboard write awaits native completion and reports asynchronous rejection`, async () => {
    let rejectWrite!: (error: Error) => void;
    const nativeWrite = new Promise<void>((_resolve, reject) => {
      rejectWrite = reject;
    });
    const operations = createClipboardOperations(
      { write: () => nativeWrite, writeText: () => nativeWrite },
      (data) => data,
    );
    let completed = false;
    const pending = (
      kind === "html"
        ? operations.writeHTML({ html: "<p>test</p>", text: "test" })
        : operations.writeText("test")
    ).then((result) => {
      completed = true;
      return result;
    });
    await Promise.resolve();
    assert.equal(completed, false);
    rejectWrite(new Error("Native clipboard denied"));
    assert.deepEqual(await pending, {
      success: false,
      error: "Native clipboard denied",
    });
  });
}
