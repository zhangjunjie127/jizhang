package cn.zaizai.companion;

final class AssistantPanelLayout {
    // Coordinates use the overlay window's display origin, including the shadow gutter.
    static int[] fit(int x, int y, int width, int height, int screenWidth,
                     int bottom, int top, int gutter) {
        int h = Math.min(height, Math.max(1, bottom - top));
        int panelY = Math.max(top, Math.min(y, bottom - h));
        int panelX = Math.max(0, Math.min(x, screenWidth - width));
        int windowX = Math.max(0, panelX - gutter);
        int windowY = Math.max(0, panelY - gutter);
        int windowRight = Math.min(screenWidth, panelX + width + gutter);
        int windowBottom = Math.min(bottom, panelY + h + gutter);
        return new int[] { windowX, windowY, windowRight - windowX, windowBottom - windowY,
            panelX - windowX, panelY - windowY, width, h };
    }
}
