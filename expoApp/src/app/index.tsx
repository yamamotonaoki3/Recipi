/**
 * 最初の画面（`/`）。Phase 0 のプレースホルダ。
 *
 * scaffold が一通りつながっていることの確認を兼ねて、
 * バックエンドの /healthz を叩いて結果を表示する
 * （TanStack Query ＋ 生成 API クライアント）。
 *
 * スタイルは NativeWind（className に Tailwind クラス）で書く。
 */
import { ActivityIndicator, Text, View } from "react-native";

import { useHealth } from "@/api/health";

export default function IndexScreen() {
  const { data, isPending, isError } = useHealth();

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-white p-6">
      <Text className="text-2xl font-bold text-neutral-900">Recipi</Text>
      <Text className="text-neutral-500">Phase 0 — scaffold</Text>

      <View className="mt-6 items-center gap-1">
        <Text className="text-xs uppercase tracking-wide text-neutral-400">backend /healthz</Text>
        {isPending && <ActivityIndicator />}
        {isError && <Text className="text-red-600">接続できません</Text>}
        {data && (
          <Text className="text-green-700">
            {data.status} ({data.env})
          </Text>
        )}
      </View>
    </View>
  );
}
