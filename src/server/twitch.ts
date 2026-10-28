import extractor from "../../vendor/twitch/twitch.py" with { type: "text" };
import { stageExtractor } from "./yt-dlp-plugin";

export const twitchPlugin = () => stageExtractor("twitch", extractor);
