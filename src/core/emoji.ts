/**
 * Emoji 短码表与补全匹配（纯函数，零依赖）。
 *
 * 只收常用短码，够覆盖日常写作；不追 GitHub 全表（上千条）以免拖大前端包。
 */

export const EMOJI: Record<string, string> = {
  smile: "😄", grin: "😁", joy: "😂", laughing: "😆", wink: "😉", blush: "😊",
  heart_eyes: "😍", thinking: "🤔", neutral_face: "😐", sad: "😔", cry: "😢",
  sob: "😭", angry: "😠", rage: "😡", tired: "😩", sleepy: "😴", cold: "🥶",
  hot: "🥵", sick: "🤒", dizzy: "😵", shocked: "😲", wow: "😮", whisper: "🤫",
  clap: "👏", thumbsup: "👍", thumbsdown: "👎", ok_hand: "👌", wave: "👋",
  raised_hands: "🙌", pray: "🙏", fist: "✊", muscle: "💪", point_right: "👉",
  point_left: "👈", point_up: "👆", point_down: "👇", hand: "✋", handshake: "🤝",
  heart: "❤️", blue_heart: "💙", green_heart: "💚", yellow_heart: "💛",
  purple_heart: "💜", broken_heart: "💔", two_hearts: "💕", sparkling_heart: "💖",
  fire: "🔥", sparkles: "✨", star: "⭐", star2: "🌟", zap: "⚡", rainbow: "🌈",
  sun: "☀️", moon: "🌙", cloud: "☁️", snowflake: "❄️", umbrella: "☂️",
  earth: "🌍", globe: "🌐", wave_ocean: "🌊", tree: "🌳", leaf: "🍃",
  flower: "🌸", rose: "🌹", tulip: "🌷", cactus: "🌵", mushroom: "🍄",
  apple: "🍎", banana: "🍌", coffee: "☕", tea: "🍵", beer: "🍺", wine: "🍷",
  pizza: "🍕", cake: "🍰", birthday: "🎂", cookie: "🍪", chocolate: "🍫",
  dog: "🐶", cat: "🐱", mouse: "🐭", rabbit: "🐰", fox: "🦊", bear: "🐻",
  panda: "🐼", lion: "🦁", tiger: "🐯", horse: "🐴", unicorn: "🦄", bee: "🐝",
  butterfly: "🦋", fish: "🐟", whale: "🐳", dolphin: "🐬", bird: "🐦",
  check: "✅", check_mark: "✔️", x: "❌", cross: "✖️", warning: "⚠️",
  info: "ℹ️", question: "❓", exclamation: "❗", bangbang: "‼️",
  lock: "🔒", unlock: "🔓", key: "🔑", shield: "🛡️", bell: "🔔",
  email: "📧", envelope: "✉️", phone: "📱", laptop: "💻", computer: "🖥️",
  keyboard: "⌨️", mouse_three_button: "🖱️", camera: "📷", video: "📹",
  book: "📖", books: "📚", memo: "📝", pencil: "✏️", pen: "🖊️",
  folder: "📁", file: "📄", clipboard: "📋", calendar: "📅", clock: "⏰",
  timer: "⏱️", hourglass: "⌛", watch: "⌚", chart: "📊", bar_chart: "📈",
  money: "💰", dollar: "💵", euro: "💶", yen: "💴", gift: "🎁",
  rocket: "🚀", plane: "✈️", car: "🚗", bus: "🚌", train: "🚆", bike: "🚲",
  ship: "🚢", anchor: "⚓", compass: "🧭", map: "🗺️", house: "🏠",
  office: "🏢", school: "🏫", hospital: "🏥", bank: "🏦", hotel: "🏨",
  art: "🎨", music: "🎵", guitar: "🎸", piano: "🎹", microphone: "🎤",
  game: "🎮", dice: "🎲", trophy: "🏆", medal: "🏅", target: "🎯",
  bulb: "💡", idea: "💡", gear: "⚙️", wrench: "🔧", hammer: "🔨",
  mag: "🔍", mag_right: "🔎", link: "🔗", paperclip: "📎", scissors: "✂️",
  endless: "♾️", infinity: "♾️", checkered_flag: "🏁", flag: "🚩",
  100: "💯", ok: "🆗", new: "🆕", free: "🆓", up: "⬆️", down: "⬇️",
  left: "⬅️", right: "➡️", arrow_up: "⬆️", arrow_down: "⬇️",
  tada: "🎉", confetti: "🎊", party: "🥳", clinking_glasses: "🥂",
 思考: "🤔", 微笑: "😄", 点赞: "👍", 爱心: "❤️", 火: "🔥", 完成: "✅",
};

export interface EmojiMatch {
  /** 短码在文本里的起止偏移（含冒号）。 */
  from: number;
  to: number;
  shortcode: string;
  emoji: string;
}

/** 找出文本中所有 `:code:` 形式的 Emoji（最短 1 字符，跳过空白）。 */
export function findEmojiShortcodes(text: string): EmojiMatch[] {
  const out: EmojiMatch[] = [];
  const re = /:([a-z0-9_\u4e00-\u9fff]+):/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const emoji = EMOJI[m[1].toLowerCase()];
    if (!emoji) continue;
    out.push({
      from: m.index,
      to: m.index + m[0].length,
      shortcode: m[1],
      emoji,
    });
  }
  return out;
}

/** 前缀匹配短码，供补全下拉候选使用。 */
export function emojiCandidates(prefix: string, limit = 10): { label: string; value: string }[] {
  const q = prefix.toLowerCase();
  if (!q) return [];
  return Object.entries(EMOJI)
    .filter(([code]) => code.startsWith(q) && code !== q)
    .slice(0, limit)
    .map(([code, value]) => ({ label: `:${code}: ${value}`, value: `:${code}:` }));
}
