export type ScheduleStackParamList = {
  Home: undefined;
  AnimeDetail: { animeId: number; title: string; imageUrl: string };
};

export type RecsStackParamList = {
  Recommendations: undefined;
  AnimeDetail: { animeId: number; title: string; imageUrl: string };
};

export type AnimeDetailParams = {
  animeId: number;
  title: string;
  imageUrl: string;
};
