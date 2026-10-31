package cn.zaizai.companion;

public class AssistantGreetingLayoutTest {
    public static void main(String[] args) {
        for (int width : new int[] {320, 390, 800}) {
            for (boolean left : new boolean[] {true, false}) {
                for (int catY : new int[] {24, 300, 730}) {
                    int catX = left ? 0 : width - 62;
                    int bubbleWidth = Math.min(260, width - 78);
                    int[] point = AssistantGreetingLayout.position(width, 800, catX, catY,
                        62, 62, bubbleWidth, 140, 8, left);
                    if (point[0] < 8 || point[0] + bubbleWidth > width - 8
                        || point[1] < 8 || point[1] + 140 > 792) throw new AssertionError("Bubble clipped");
                    if (left && point[0] < catX + 62) throw new AssertionError("Left cat covered");
                    if (!left && point[0] + bubbleWidth > catX) throw new AssertionError("Right cat covered");
                }
            }
        }
        System.out.println("PASS: greeting bounds, both docks and short screens");
    }
}
