import { useCallback, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/AppText";
import { ErrorBanner } from "../components/ErrorBanner";
import { useThemeColor } from "../lib/useThemeColor";
import { clearFatalError, getLastFatalError, subscribeFatalError } from "./fatalError";

export function FatalErrorHost(props: { readonly onGoHome: () => void }) {
  const record = useSyncExternalStore(subscribeFatalError, getLastFatalError, getLastFatalError);
  const insets = useSafeAreaInsets();
  const pressedOverlay = useThemeColor("--color-subtle");

  const handleDismiss = useCallback(() => {
    clearFatalError();
  }, []);

  if (record === null) {
    return null;
  }

  return (
    <View
      accessibilityViewIsModal
      className="z-50 bg-backdrop px-6"
      pointerEvents="auto"
      style={[
        StyleSheet.absoluteFill,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <View className="max-h-full w-full self-center rounded-[24px] bg-card px-5 pb-4 pt-5">
        <Text className="text-lg font-t3-medium">Something went wrong</Text>
        <Text className="mt-2 text-sm text-foreground-secondary">
          The app caught an unexpected error and stayed open. Try again, or return home.
        </Text>
        <View className="mt-4">
          <ErrorBanner message={record.message} />
        </View>
        <Text className="mt-3 text-xs text-foreground-muted">{record.occurredAt}</Text>
        <View className="mt-5 flex-row justify-end gap-1">
          <View className="overflow-hidden rounded-full">
            <Pressable
              accessibilityRole="button"
              android_ripple={{ color: pressedOverlay }}
              className="min-h-10 items-center justify-center px-4"
              onPress={handleDismiss}
            >
              <Text className="text-base font-t3-medium">Dismiss</Text>
            </Pressable>
          </View>
          <View className="overflow-hidden rounded-full">
            <Pressable
              accessibilityRole="button"
              android_ripple={{ color: pressedOverlay }}
              className="min-h-10 items-center justify-center px-4"
              onPress={props.onGoHome}
            >
              <Text className="text-base font-t3-medium">Go home</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
