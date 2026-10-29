import extractor from "../../vendor/raiplay/raiplay.py" with { type: "text" };
import { stageExtractor } from "./yt-dlp-plugin";

export const raiPlayPreviewPlugin = () => stageExtractor("raiplay", extractor);
