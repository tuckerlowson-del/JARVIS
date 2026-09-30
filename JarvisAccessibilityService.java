package com.jarvis.android;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

public class JarvisAccessibilityService extends AccessibilityService {
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { }
    @Override public void onInterrupt() { }

    public boolean isEnabledForJARVIS() { return true; }

    public boolean clickText(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        return clickRecursive(root, text);
    }

    private boolean clickRecursive(AccessibilityNodeInfo node, String text) {
        if (node.getText() != null && text.contentEquals(node.getText())) {
            if (node.isClickable()) return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null && clickRecursive(child, text)) return true;
        }
        return false;
    }
}
