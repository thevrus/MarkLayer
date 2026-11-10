import { operations } from '@ext/lib/ops';
import { localPeerId, wsSend } from '@ext/lib/realtime';
import { getSelector, pickElementAtPoint } from '@ext/lib/selector';
import { hidePresentation, lastTeachingControl, presentation, showTeachingComposer } from '@ext/lib/teaching';
import { useSignalEffect } from '@preact/signals';
import { nanoid } from 'nanoid';
import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { cssScale, frameRect, iframeMutationTick, iframeScrollY } from './viewer-state';

interface Step { selector: string; caption: string }

export function TeachLayer({ frameRef }: { frameRef: RefObject<HTMLIFrameElement> }) {
  const [picking, setPicking] = useState(false);
  const [selector, setSelector] = useState('');
  const [caption, setCaption] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const owned = useRef<{ id: string; steps: Step[]; index: number; paused: boolean } | null>(null);
  const current = presentation.value;
  const frameBox = frameRect.value;
  const scale = cssScale.value;
  const scrollY = iframeScrollY.value;
  iframeMutationTick.value;

  const send = (msg: object) => wsSend.value?.(msg);
  const publish = (show: NonNullable<typeof owned.current>) => {
    const step = show.steps[show.index];
    if (!step) return;
    send({ type: 'teach_highlight', presentationId: show.id, selector: step.selector });
    send({ type: 'teach_caption', presentationId: show.id, text: step.caption, step: show.index, total: show.steps.length });
    send({ type: 'teach_state', presentationId: show.id, state: show.paused ? 'paused' : 'active', step: show.index, total: show.steps.length });
  };
  useSignalEffect(() => {
    const control = lastTeachingControl.value;
    const show = owned.current;
    if (!control || !show || control.presentationId !== show.id) return;
    if (control.action === 'previous') show.index = Math.max(0, show.index - 1);
    if (control.action === 'next') show.index = Math.min(show.steps.length - 1, show.index + 1);
    if (control.action === 'pause') show.paused = true;
    if (control.action === 'resume') show.paused = false;
    publish(show);
  });

  let box: { left: number; top: number; width: number; height: number } | null = null;
  if (current?.highlight && frameBox) {
    const highlight = current.highlight;
    const annotation = highlight.annotationId ? operations.value.find((op) => op.id === highlight.annotationId) : undefined;
    const target = highlight.selector ?? (annotation && 'target' in annotation ? annotation.target?.selector : undefined);
    let element: Element | null = null;
    try { if (target) element = frameRef.current?.contentDocument?.querySelector(target) ?? null; } catch { /* invalid selector */ }
    if (element) {
      const r = element.getBoundingClientRect();
      box = { left: frameBox.left + r.left * scale, top: frameBox.top + r.top * scale, width: r.width * scale, height: r.height * scale };
    } else {
      const r = highlight.rect ?? (annotation && 'target' in annotation ? annotation.target?.rect : undefined);
      if (r) box = { left: frameBox.left + r.x * scale, top: frameBox.top + (r.y - scrollY) * scale, width: r.width * scale, height: r.height * scale };
      else if (annotation && 'x' in annotation && 'y' in annotation) box = { left: frameBox.left + annotation.x * scale - 12, top: frameBox.top + (annotation.y - scrollY) * scale - 12, width: 24, height: 24 };
    }
  }
  const add = () => {
    if (!selector || !caption.trim()) return;
    setSteps([...steps, { selector, caption: caption.trim() }]);
    setCaption(''); setSelector('');
  };
  const start = () => {
    const all = selector && caption.trim() ? [...steps, { selector, caption: caption.trim() }] : steps;
    if (!all.length) return;
    const show = { id: `human-${nanoid()}`, steps: all, index: 0, paused: false };
    owned.current = show; publish(show);
    showTeachingComposer.value = false; setSteps([]); setSelector(''); setCaption('');
  };
  return <>
    {picking && frameBox && <div aria-label="选择演示目标" class="fixed z-2147483646 cursor-crosshair" style={{ left: frameBox.left, top: frameBox.top, width: frameBox.width, height: frameBox.height, background: 'rgba(80,80,200,.08)' }} onClick={(event) => {
      const doc = frameRef.current?.contentDocument;
      const el = doc && pickElementAtPoint((event.clientX - frameBox.left) / scale, (event.clientY - frameBox.top) / scale, doc);
      if (el) setSelector(getSelector(el));
      setPicking(false);
    }} />}
    {showTeachingComposer.value && !picking && <section aria-label="创建演示" class="fixed right-5 top-20 z-2147483647 rounded-xl bg-white p-4 shadow-xl text-black" style={{ width: 320 }}>
      <h2>创建演示</h2><p>已添加 {steps.length} 步</p>
      <button type="button" onClick={() => setPicking(true)}>选择页面目标</button>
      <p>{selector || '尚未选择目标'}</p>
      <textarea aria-label="讲解内容" value={caption} onInput={(e) => setCaption(e.currentTarget.value)} class="w-full border" />
      <div class="flex gap-2"><button type="button" onClick={add}>添加步骤</button><button type="button" onClick={start}>开始演示</button><button type="button" onClick={() => { showTeachingComposer.value = false; }}>取消</button></div>
    </section>}
    {current && !current.hidden && <>
      {box && <div aria-hidden="true" class="fixed pointer-events-none z-2147483645" style={{ ...box, border: '3px solid #7c3aed', borderRadius: 6, boxShadow: '0 0 0 4px rgba(124,58,237,.2)' }} />}
      <section aria-label="演示控制" class="fixed left-1/2 -translate-x-1/2 z-2147483647 rounded-xl bg-white p-3 shadow-xl text-black" style={{ bottom: box && box.top > window.innerHeight / 2 ? 'auto' : 90, top: box && box.top > window.innerHeight / 2 ? 80 : 'auto', maxWidth: 'min(90vw, 560px)' }}>
        <p>{current.caption || '演示已开始'} {current.total ? `${(current.step ?? 0) + 1}/${current.total}` : ''}</p>
        <div class="flex gap-2">{(['previous', current.state === 'paused' ? 'resume' : 'pause', 'next'] as const).map((action) => <button type="button" onClick={() => send({ type: 'teach_control', presentationId: current.id, action })}>{action === 'previous' ? '上一步' : action === 'next' ? '下一步' : action === 'pause' ? '暂停' : '继续'}</button>)}
          <button type="button" onClick={hidePresentation}>关闭</button>
          {current.presenter === localPeerId && <button type="button" onClick={() => { send({ type: 'teach_state', presentationId: current.id, state: 'ended' }); owned.current = null; }}>结束演示</button>}
        </div>
      </section>
    </>}
  </>;
}
