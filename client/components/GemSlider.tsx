import Slider from "@react-native-community/slider";
import { Colors } from "@/constants/theme";

interface GemSliderProps {
  value: number;
  onValueChange?: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
  style?: object;
}

export default function GemSlider({ value, onValueChange, onSlidingComplete, style }: GemSliderProps) {
  return (
    <Slider
      style={style}
      minimumValue={0}
      maximumValue={1}
      step={0.05}
      value={value}
      onValueChange={onValueChange}
      onSlidingComplete={onSlidingComplete}
      minimumTrackTintColor={Colors.dark.accent}
      maximumTrackTintColor={Colors.dark.glassBorder}
      thumbTintColor={Colors.dark.accent}
    />
  );
}
