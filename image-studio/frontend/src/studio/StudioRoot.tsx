import { usePlatform } from "../platform/context";
import { StudioApp } from "./StudioApp";
import "./studio.css";
import "./polish.css";
import "./dialogs.css";
import "./motion.css";

/** Studio is the sole application entry; legacy data is migrated by the client. */
export default function StudioRoot() {
  const { isMac } = usePlatform();
  return <StudioApp isMac={isMac} />;
}
