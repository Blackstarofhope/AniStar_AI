import React from "react";
import { Platform, View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { HeaderTitle } from "@/components/HeaderTitle";
import { Colors } from "@/constants/theme";
import { useUser } from "@/contexts/UserContext";
import HomeScreen from "@/screens/HomeScreen";
import AnimeDetailScreen from "@/screens/AnimeDetailScreen";
import RecommendationsScreen from "@/screens/RecommendationsScreen";
import LibraryScreen from "@/screens/LibraryScreen";
import type {
  ScheduleStackParamList,
  RecsStackParamList,
  LibraryStackParamList,
} from "./types";

const ScheduleStack = createNativeStackNavigator<ScheduleStackParamList>();
const RecsStack = createNativeStackNavigator<RecsStackParamList>();
const LibraryStack = createNativeStackNavigator<LibraryStackParamList>();
const Tab = createBottomTabNavigator();

function ScheduleNavigator() {
  const screenOptions = useScreenOptions();
  return (
    <ScheduleStack.Navigator
      screenOptions={{
        ...screenOptions,
        contentStyle: { backgroundColor: Colors.dark.backgroundRoot },
      }}
    >
      <ScheduleStack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerTitle: () => <HeaderTitle title="AniStar" /> }}
      />
      <ScheduleStack.Screen
        name="AnimeDetail"
        component={AnimeDetailScreen}
        options={{ headerTitle: "", headerTransparent: true }}
      />
    </ScheduleStack.Navigator>
  );
}

function LibraryNavigator() {
  const screenOptions = useScreenOptions();
  return (
    <LibraryStack.Navigator
      screenOptions={{
        ...screenOptions,
        contentStyle: { backgroundColor: Colors.dark.backgroundRoot },
      }}
    >
      <LibraryStack.Screen
        name="Library"
        component={LibraryScreen}
        options={{ headerTitle: () => <HeaderTitle title="Library" /> }}
      />
    </LibraryStack.Navigator>
  );
}

function RecommendationsNavigator() {
  const screenOptions = useScreenOptions();
  return (
    <RecsStack.Navigator
      screenOptions={{
        ...screenOptions,
        contentStyle: { backgroundColor: Colors.dark.backgroundRoot },
      }}
    >
      <RecsStack.Screen
        name="Recommendations"
        component={RecommendationsScreen}
        options={{ headerTitle: () => <HeaderTitle title="For You" /> }}
      />
      <RecsStack.Screen
        name="AnimeDetail"
        component={AnimeDetailScreen}
        options={{ headerTitle: "", headerTransparent: true }}
      />
    </RecsStack.Navigator>
  );
}

export default function TabNavigator() {
  const { preferredStartTab } = useUser();
  return (
    <Tab.Navigator
      initialRouteName={preferredStartTab}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.dark.backgroundDefault,
          borderTopColor: Colors.dark.glassBorder,
          borderTopWidth: 1,
          paddingTop: 4,
          height: Platform.OS === "ios" ? 84 : 64,
        },
        tabBarActiveTintColor: Colors.dark.accent,
        tabBarInactiveTintColor: Colors.dark.tabIconDefault,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
          marginBottom: Platform.OS === "ios" ? 0 : 6,
        },
        tabBarIcon: ({ focused, color, size }) => {
          if (route.name === "Schedule") {
            return (
              <Ionicons
                name={focused ? "calendar" : "calendar-outline"}
                size={size}
                color={color}
              />
            );
          }
          if (route.name === "LibraryTab") {
            return (
              <Ionicons
                name={focused ? "library" : "library-outline"}
                size={size}
                color={color}
              />
            );
          }
          if (route.name === "ForYou") {
            return (
              <Ionicons
                name={focused ? "sparkles" : "sparkles-outline"}
                size={size}
                color={color}
              />
            );
          }
          return <View />;
        },
      })}
    >
      <Tab.Screen
        name="Schedule"
        component={ScheduleNavigator}
        options={{ tabBarLabel: "Schedule" }}
      />
      <Tab.Screen
        name="LibraryTab"
        component={LibraryNavigator}
        options={{ tabBarLabel: "Library" }}
      />
      <Tab.Screen
        name="ForYou"
        component={RecommendationsNavigator}
        options={{ tabBarLabel: "For You" }}
      />
    </Tab.Navigator>
  );
}
