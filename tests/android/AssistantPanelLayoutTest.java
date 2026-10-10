package cn.zaizai.companion;

public class AssistantPanelLayoutTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        int[] normal = AssistantPanelLayout.fit(8, 500, 374, 570, 390, 804, 24, 24);
        int[] keyboard = AssistantPanelLayout.fit(8, 500, 374, 570, 390, 484, 24, 24);
        check(keyboard[1] + keyboard[5] + keyboard[7] <= 484, "Input must stay above keyboard");
        check(keyboard[7] < normal[7], "Small available area must resize the conversation");
        check(keyboard[6] == normal[6], "Keyboard must not change panel width");
        check(java.util.Arrays.equals(normal,
            AssistantPanelLayout.fit(8, 500, 374, 570, 390, 804, 24, 24)), "Keyboard close restores bounds");
        int[] tall = AssistantPanelLayout.fit(400, 500, 390, 570, 800, 900, 24, 24);
        check(tall[7] == 570 && tall[1] + tall[5] == 330, "Move up before shrinking");
        for (int bottom : new int[] {180, 320, 484, 804}) {
            int[] b = AssistantPanelLayout.fit(8, 600, 374, 570, 390, bottom, 24, 24);
            check(b[1] + b[5] >= 24, "Panel top stays on screen");
            check(b[1] + b[5] + b[7] <= bottom, "Panel bottom stays in visible area");
            check(b[1] + b[3] <= bottom, "Shadow window stays above keyboard too");
        }
        System.out.println("PASS: keyboard bounds, short screens, upward movement and restoration");
    }
}
