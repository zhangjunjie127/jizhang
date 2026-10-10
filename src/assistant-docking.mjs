export const ASSISTANT_WIDTH = 62.4;
export const ASSISTANT_HEIGHT = 41.6;
// All current and future full-body idle animations use 1.5 times the edge width.
export const ASSISTANT_CENTER_SIZE = ASSISTANT_WIDTH * 1.5;

export function dockAssistant(x, y, width, height, edge) {
  const maxX = Math.max(0, width - ASSISTANT_WIDTH);
  const dock = edge || (y + ASSISTANT_HEIGHT >= height - 48 ? 'bottom' : x < width / 2 ? 'left' : 'right');
  if (dock === 'center') {
    return { dock, x: Math.max(0, Math.min(width - ASSISTANT_CENTER_SIZE, x)), y: Math.max(0, Math.min(height - ASSISTANT_CENTER_SIZE, y)) };
  }
  if (dock === 'bottom') {
    return { dock, x: Math.max(0, Math.min(maxX, x)), y: Math.max(0, height - ASSISTANT_HEIGHT) };
  }
  const boxHeight = dock === 'left' ? ASSISTANT_WIDTH : ASSISTANT_HEIGHT;
  return { dock, x: dock === 'left' ? 0 : maxX, y: Math.max(16, Math.min(height - boxHeight - 16, y)) };
}

export function releaseAssistant(x, y, width, height, previousDock) {
  const boxWidth = previousDock === 'center' ? ASSISTANT_CENTER_SIZE : ASSISTANT_WIDTH;
  const boxHeight = previousDock === 'center' ? ASSISTANT_CENTER_SIZE : ASSISTANT_HEIGHT;
  if (y + boxHeight >= height - 48) return dockAssistant(x, y, width, height, 'bottom');
  if (x <= 32) return dockAssistant(x, y, width, height, 'left');
  if (x + boxWidth >= width - 32) return dockAssistant(x, y, width, height, 'right');
  return dockAssistant(x, y, width, height, 'center');
}
