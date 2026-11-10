import {
  Archive, ArrowLeft, ArrowUp, AudioLines, Bell, Blocks, Bookmark, Brain, Camera, ChartColumn, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleCheck, CircleExclamationPoint, CircleUser, CircleX, Clock, ClockFading, Cloud, Code, Compass, Copy, Cpu, DollarSign, Download, Ellipsis,
  EllipsisVertical, ExternalLink, EyeOff, FastForward, FileCode, FileSearch, FileSpreadsheet, FileText, FileType, FileUp, FlaskConical, Flag, Folder, Gauge, Ghost, Globe,
  Hash, Image, ImagePlus, Inbox, Info, KeyRound, Laptop, Layers2, ListChecks, ListFilter, Lock, LogOut, Menu, MessageCircle, Mic, Minus,
  Monitor, Moon, Palette, Paperclip, Pencil, PiggyBank, Pin, Plus, Presentation, RotateCw, ScanQrCode, ScrollText, Search, Settings, Share, ShieldCheck,
  SlidersHorizontal, Smartphone, Sparkles, Square, SquarePen, SquareStack, Star, Sun, Terminal, Trash, TriangleExclamationPoint, Upload,
  User, Users, UsersRound, Vibrate, Volume2, WandSparkles, Wrench, X, Zap, type LucideIcon,
} from 'lucide-react-native';
import { Platform, Pressable, type ViewStyle } from 'react-native';

import { haptic } from '@/haptics';
import { TAP } from '@/theme';

// Open-licensed outline icons (Lucide, ISC) on every platform, drawn thin to match the calm, line-art look of the app.
const names = {
  menu: Menu,
  compose: SquarePen,
  plus: Plus,
  download: Download,
  minus: Minus,
  mic: Mic,
  send: ArrowUp,
  stop: Square,
  close: X,
  check: Check,
  copy: Copy,
  settings: Settings,
  cloud: Cloud,
  sliders: SlidersHorizontal,
  person: User,
  language: Globe,
  palette: Palette,
  vibration: Vibrate,
  star: Star,
  trash: Trash,
  desktop: Monitor,
  laptop: Laptop,
  team: Users,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  camera: Camera,
  photo: Image,
  file: Paperclip,
  terminal: Terminal,
  doc: FileText,
  search: Search,
  qr: ScanQrCode,
  retry: RotateCw,
  link: ExternalLink,
  sparkles: Sparkles,
  chat: MessageCircle,
  lab: FlaskConical,
  compass: Compass,
  chevronLeft: ChevronLeft,
  share: Share,
  speaker: Volume2,
  code: Code,
  bell: Bell,
  wrench: Wrench,
  checkCircle: CircleCheck,
  xCircle: CircleX,
  shield: ShieldCheck,
  alertCircle: CircleExclamationPoint,
  warning: TriangleExclamationPoint,
  checklist: ListChecks,
  fileCode: FileCode,
  lock: Lock,
  eyeOff: EyeOff,
  clock: Clock,
  moon: Moon,
  sun: Sun,
  savings: PiggyBank,
  brain: Brain,
  inbox: Inbox,
  people: UsersRound,
  // Added with the 0.16 redesign.
  back: ArrowLeft,
  info: Info,
  folder: Folder,
  project: Layers2,
  artifact: SquareStack,
  connectors: Blocks,
  skills: ScrollText,
  research: FileSearch,
  permission: FastForward,
  ghost: Ghost,
  key: KeyRound,
  filter: ListFilter,
  pin: Pin,
  gauge: Gauge,
  billing: DollarSign,
  profile: CircleUser,
  pencil: Pencil,
  more: EllipsisVertical,
  moreH: Ellipsis,
  chart: ChartColumn,
  wand: WandSparkles,
  flag: Flag,
  history: ClockFading,
  archive: Archive,
  voice: AudioLines,
  upload: Upload,
  fileUp: FileUp,
  imagePlus: ImagePlus,
  phone: Smartphone,
  cpu: Cpu,
  zap: Zap,
  bookmark: Bookmark,
  hash: Hash,
  logout: LogOut,
  // Office files.
  slides: Presentation,
  sheet: FileSpreadsheet,
  word: FileType,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof names;

export function Icon({ name, size = 22, color, strokeWidth }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  const Glyph = names[name];
  // Thinner strokes on larger glyphs keep the visual weight even across sizes.
  return <Glyph size={size} color={color} strokeWidth={strokeWidth ?? (size >= 22 ? 1.6 : 1.8)} />;
}

/** Icon with a 48dp touch target and a screen-reader label. */
export function IconButton({ name, label, color, onPress, size, style, disabled = false }: { name: IconName; label: string; color: string; onPress: () => void; size?: number; style?: ViewStyle; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => (haptic.light(), onPress())}
      disabled={disabled}
      accessibilityState={{ disabled }}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: 'rgba(128,128,128,0.2)', borderless: true, radius: TAP / 2 }}
      style={({ pressed }) => [{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed && Platform.OS === 'ios' ? 0.5 : 1 }, style]}
    >
      <Icon name={name} color={color} size={size} />
    </Pressable>
  );
}
