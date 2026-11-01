import extractor from "../../vendor/bandcamp/bandcamp.py" with { type: "text" };
import { stageExtractor } from "./yt-dlp-plugin";

export const bandcampSearchPlugin = () => stageExtractor("bandcamp", extractor);
