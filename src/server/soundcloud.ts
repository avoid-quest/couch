import extractor from "../../vendor/soundcloud/soundcloud.py" with { type: "text" };
import { stageExtractor } from "./yt-dlp-plugin";

export const soundCloudPlugin = () => stageExtractor("soundcloud", extractor);
