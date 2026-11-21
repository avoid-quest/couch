import { LiveFeed, type ToFeed } from "./live-feed";

// The Live player's feed off the page's main thread (live-feed.ts).
const scope = self;
let feed: LiveFeed | undefined;
scope.onmessage = ({ data }: MessageEvent<ToFeed>) => {
  if (data.type === "start")
    feed = new LiveFeed(data.config, data.stored, data.pageMs, (message) =>
      scope.postMessage(message),
    );
  else feed?.handle(data);
  if (data.type === "destroy") scope.close();
};
