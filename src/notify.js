// Vince notifications facade. The logic lives in small modules:
//   telegram.js       Bot API transport, chat ids, VINCE_PING_OFF hard stop
//   cards.js          card, no-deal, follow-up copy and button keyboards
//   digest.js         the one-a-day pick send (crash-safe, alias dedupe)
//   callbacks.js      button taps (call outcome + bad-lead reasons)
//   legacy-notify.js  instant alerts (VINCE_INSTANT=1 only) + server.js pings
//   vstate.js         state file load/save + legacy leadKey
export { enabled, sendText } from "./telegram.js";
export {
  formatLead,
  formatLeadName,
  formatLeadDetails,
  formatNoDeal,
  formatFollowUp,
  contactName,
} from "./cards.js";
export { leadKey } from "./vstate.js";
export { runDailyDigest, DAILY_CAP } from "./digest.js";
export { pollCallbacks } from "./callbacks.js";
export { runInstantAlerts, diffAndNotify } from "./legacy-notify.js";
