import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

export interface RewritePreview {
  to: number;
  text: string;
}

export const setRewritePreview = StateEffect.define<RewritePreview | null>();

class PreviewWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: PreviewWidget) {
    return other.text === this.text;
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-ai-preview";

    const label = document.createElement("div");
    label.className = "cm-ai-preview-label";
    label.textContent = "改写结果";

    const body = document.createElement("div");
    body.className = "cm-ai-preview-body";
    body.textContent = this.text;

    wrap.append(label, body);
    return wrap;
  }

  // 只把新增的尾部作为新节点追加，既省重排也让分片能各自淡入
  updateDOM(dom: HTMLElement) {
    const body = dom.querySelector<HTMLElement>(".cm-ai-preview-body");
    if (!body) return false;

    const shown = body.textContent ?? "";
    if (shown === this.text) return true;

    if (!this.text.startsWith(shown)) {
      body.textContent = this.text;
      return true;
    }

    const chunk = document.createElement("span");
    chunk.className = "cm-ai-preview-chunk";
    chunk.textContent = this.text.slice(shown.length);
    body.appendChild(chunk);
    return true;
  }
}

export const rewritePreviewField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);

    for (const effect of tr.effects) {
      if (!effect.is(setRewritePreview)) continue;
      const payload = effect.value;

      if (!payload) {
        next = Decoration.none;
        continue;
      }

      const anchor = Math.max(0, Math.min(payload.to, tr.state.doc.length));
      const line = tr.state.doc.lineAt(anchor);
      next = Decoration.set([
        Decoration.widget({
          widget: new PreviewWidget(payload.text),
          block: true,
          side: 1,
        }).range(line.to),
      ]);
    }

    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    // 预览期间藏掉编辑器光标，否则它就停在预览块和控制条中间一直闪
    EditorView.editorAttributes.from(field, (value) => ({
      class: value.size ? "cm-ai-previewing" : "",
    })),
  ],
});
