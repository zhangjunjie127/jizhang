package cn.zaizai.companion;

final class AssistantGreetingLayout {
    private AssistantGreetingLayout() {}
    static int[] position(int screenWidth, int screenHeight, int catX, int catY,
            int catWidth, int catHeight, int width, int height, int margin, boolean left) {
        int x = left ? catX + catWidth : catX - width;
        int y = catY + (catHeight - height) / 2;
        return new int[] {
            Math.max(margin, Math.min(x, screenWidth - width - margin)),
            Math.max(margin, Math.min(y, screenHeight - height - margin))
        };
    }
}
