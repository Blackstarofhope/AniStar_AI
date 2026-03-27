export type { ScheduleStackParamList, RecsStackParamList, AnimeDetailParams } from "./types";

export type RootStackParamList = {
  Home: undefined;
  AnimeDetail: { animeId: number; title: string; imageUrl: string };
};

export { default } from "./TabNavigator";
