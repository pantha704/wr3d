/**
 * Shell concerns: first-run intro, fatal-error boundary, result line.
 * Everything here is presentation; no sim state lives in this file.
 */

export function mountIntro(onStart: () => void): void {
  const el = document.getElementById('intro');
  if (!el) return;
  const seen = ((): boolean => {
    try {
      return localStorage.getItem('wr3d.intro.seen') === '1';
    } catch {
      return false;
    }
  })();

  if (seen) {
    el.remove();
    return;
  }

  el.hidden = false;
  const btn = el.querySelector<HTMLButtonElement>('#intro-go')!;
  btn.focus();
  btn.onclick = (): void => {
    el.hidden = true;
    el.remove();
    try {
      localStorage.setItem('wr3d.intro.seen', '1');
    } catch {
      /* private mode: show it again next time, harmless */
    }
    onStart();
  };
}

/** Catch anything that escapes the render loop so the player sees a reason. */
export function mountErrorBoundary(): void {
  const show = (detail: unknown): void => {
    const box = document.getElementById('fatal');
    const msg = document.getElementById('fatal-msg');
    if (!box || !msg) return;
    msg.textContent = String(detail instanceof Error ? `${detail.message}\n${detail.stack ?? ''}` : detail);
    box.hidden = false;
  };

  addEventListener('error', (e) => show(e.error ?? e.message));
  addEventListener('unhandledrejection', (e) => show(e.reason));

  document.getElementById('fatal-reload')?.addEventListener('click', () => location.reload());
}
