import { cn } from '@marklayer/ui/cn';
import { Camera } from 'lucide-preact';
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { useCardHold } from '../lib/card-hold';
import { geist } from '../lib/geist';
import { portalContainer } from '../lib/portal';
import type { Attachments } from './AttachmentPicker';
import { Tooltip } from './Tooltip';

export function ScreenCapture({ attachments }: { attachments: Attachments }) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState('');
  const hold = useCardHold();
  useEffect(() => { if (!preview) return; hold?.(true); return () => { URL.revokeObjectURL(preview.url); hold?.(false); }; }, [preview]);
  const capture = async () => {
    setError('');
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track || track.getSettings().displaySurface !== 'browser') throw new Error('请选择当前浏览器标签页');
      const video = document.createElement('video'); video.srcObject = stream; await video.play();
      const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height) throw new Error('无法读取截图');
      context.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('无法生成截图');
      const file = new File([blob], '界面截图.png', { type: 'image/png' });
      setPreview({ file, url: URL.createObjectURL(file) });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotAllowedError')) setError(e instanceof Error ? e.message : '截图失败');
    } finally { stream?.getTracks().forEach((track) => track.stop()); }
  };
  return <>
    {typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function' && <button type="button" disabled={attachments.full} onClick={() => void capture()} aria-label="截取当前界面" class={cn(geist.ctlXs, geist.ctlIdle)}><Camera size={14} aria-hidden="true" /><Tooltip text="截取当前界面" /></button>}
    {error && <span role="alert">{error}</span>}
    {preview && createPortal(<div role="dialog" aria-label="截图预览" class="fixed inset-0 z-2147483647 flex items-center justify-center bg-black/60"><div class="rounded-xl bg-white p-4 text-black" style={{ maxWidth: '90vw', maxHeight: '90vh' }}><h2>截图预览</h2><img src={preview.url} alt="待上传的界面截图" style={{ maxWidth: '80vw', maxHeight: '65vh', objectFit: 'contain' }} /><div><button type="button" onClick={() => setPreview(null)}>取消</button><button type="button" onClick={() => { attachments.addFiles([preview.file]); setPreview(null); }}>使用截图</button></div></div></div>, portalContainer.value ?? document.body)}
  </>;
}
