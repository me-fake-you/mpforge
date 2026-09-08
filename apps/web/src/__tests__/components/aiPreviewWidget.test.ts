import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  rewritePreviewField,
  setRewritePreview,
} from "../../components/Editor/AiRewrite/aiPreviewWidget";

const DOC = "第一段内容\n\n第二段内容";
let view: EditorView | undefined;

function mount() {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    state: EditorState.create({ doc: DOC, extensions: [rewritePreviewField] }),
    parent,
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.innerHTML = "";
});

describe("正文改写预览", () => {
  it("派发效果后在正文中插入预览块", () => {
    const editor = mount();
    editor.dispatch({
      effects: setRewritePreview.of({ to: 5, text: "改写后的内容" }),
    });

    const block = editor.dom.querySelector(".cm-ai-preview");
    expect(block).not.toBeNull();
    expect(block?.querySelector(".cm-ai-preview-label")?.textContent).toBe(
      "改写结果",
    );
    expect(block?.querySelector(".cm-ai-preview-body")?.textContent).toBe(
      "改写后的内容",
    );
  });

  it("追加分片时只补新增尾部，不重建整块", () => {
    const editor = mount();
    editor.dispatch({
      effects: setRewritePreview.of({ to: 5, text: "改写" }),
    });
    const first = editor.dom.querySelector(".cm-ai-preview");

    editor.dispatch({
      effects: setRewritePreview.of({ to: 5, text: "改写后的内容" }),
    });
    const second = editor.dom.querySelector(".cm-ai-preview");

    expect(second).toBe(first);
    expect(second?.querySelector(".cm-ai-preview-body")?.textContent).toBe(
      "改写后的内容",
    );
    expect(second?.querySelectorAll(".cm-ai-preview-chunk")).toHaveLength(1);
  });

  it("清空效果后移除预览块，文档始终未被改动", () => {
    const editor = mount();
    editor.dispatch({
      effects: setRewritePreview.of({ to: 5, text: "改写后的内容" }),
    });
    editor.dispatch({ effects: setRewritePreview.of(null) });

    expect(editor.dom.querySelector(".cm-ai-preview")).toBeNull();
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it("预览期间给编辑器加类名，用于隐藏原生光标", () => {
    const editor = mount();
    expect(editor.dom.classList.contains("cm-ai-previewing")).toBe(false);

    editor.dispatch({
      effects: setRewritePreview.of({ to: 5, text: "改写后的内容" }),
    });
    expect(editor.dom.classList.contains("cm-ai-previewing")).toBe(true);

    editor.dispatch({ effects: setRewritePreview.of(null) });
    expect(editor.dom.classList.contains("cm-ai-previewing")).toBe(false);
  });
});
