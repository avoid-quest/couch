import {
  roomStyle,
  useArtworkLight,
  useArtworkPicture,
  useLeadPicture,
} from "@/components/AmbientLight";
import { useStationShow } from "@/sections/home/on-air";
import { useSessionGate } from "@/session/session-context";
import { useShell } from "./shell-context";

const levels = { playing: 1, paused: 0.3, lead: 0.5 };

/**
 * The room's light (docs/design.md, Room). What plays lights the whole room from its picture, a video's too: paused dims
 * it, and once nothing plays it goes out. With nothing playing, the picture the page leads with lights it a little.
 * `style` and `state` go on the shell, under which every surface reads the lamps; `picture` is thrown blurred on the wall.
 */
export function useRoomLight() {
  const { active, current } = useShell();
  const { state } = useSessionGate();
  const programme = useStationShow();
  const lead = useLeadPicture();
  const picture = active ? programme?.artworkUrl || current?.thumbnail : lead;
  const light = useArtworkLight(picture);
  const status = active ? (state?.player.status === "paused" ? "paused" : "playing") : "lead";
  return {
    picture: light ? picture : undefined,
    state: light ? status : undefined,
    style: roomStyle(light, levels[status]),
  };
}

/** The room behind every screen, lit as `useRoomLight` says. */
export function RoomLight({ picture }: { picture: string | undefined }) {
  const shown = useArtworkPicture(picture);
  return (
    <div aria-hidden="true" className="room room-light">
      {shown && <img src={shown} alt="" className="room-picture" />}
    </div>
  );
}
