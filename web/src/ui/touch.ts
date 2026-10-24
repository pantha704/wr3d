/**
 * On-screen controls for touch devices. Emits the same Intent shape as the
 * keyboard so the sim has exactly one input contract.
 */
import type { Intent } from '../sim/arena';

export function mountTouchControls(host: HTMLElement): () => Intent {
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="pad">
      <button class="up" data-k="up" aria-label="Move away">▲</button>
      <button class="left" data-k="left" aria-label="Move left">◀</button>
      <button class="down" data-k="down" aria-label="Move toward">▼</button>
      <button class="right" data-k="right" aria-label="Move right">▶</button>
    </div>
    <div class="acts">
      <button class="grab" data-k="grapple" aria-label="Grapple">G</button>
      <button class="hit" data-k="strike" aria-label="Strike">HIT</button>
    </div>`;
  host.appendChild(root);

  const down = new Set<string>();
  const set = (k: string, on: boolean): void => {
    if (on) down.add(k);
    else down.delete(k);
  };

  root.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    const k = btn.dataset.k!;
    const press = (e: PointerEvent): void => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      set(k, true);
    };
    const release = (e: PointerEvent): void => {
      e.preventDefault();
      set(k, false);
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  });

  return () => ({
    moveX: (down.has('right') ? 1 : 0) - (down.has('left') ? 1 : 0),
    moveZ: (down.has('down') ? 1 : 0) - (down.has('up') ? 1 : 0),
    strike: down.has('strike'),
    grapple: down.has('grapple'),
  });
}
