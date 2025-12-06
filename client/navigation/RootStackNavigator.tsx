import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "@/screens/HomeScreen";
import AnimeDetailScreen from "@/screens/AnimeDetailScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { HeaderTitle } from "@/components/HeaderTitle";
import { Colors } from "@/constants/theme";

export type RootStackParamList = {
  Home: undefined;
  AnimeDetail: {
    animeId: number;
    title: string;
    imageUrl: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator
      screenOptions={{
        ...screenOptions,
        contentStyle: { backgroundColor: Colors.dark.backgroundRoot },
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{
          headerTitle: () => <HeaderTitle title="AniStar" />,
        }}
      />
      <Stack.Screen
        name="AnimeDetail"
        component={AnimeDetailScreen}
        options={{
          headerTitle: "",
          headerTransparent: true,
        }}
      />
    </Stack.Navigator>
  );
}
