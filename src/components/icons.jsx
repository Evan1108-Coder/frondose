import { useId, useLayoutEffect, useRef } from "react";
import { MorphIcon } from "morphicons/react";
import {
  Activity as ActivityNode, Archive as ArchiveNode, RotateCw as RotateCwNode,
  Sun as SunNode, Moon as MoonNode,
  RotateCcw as RotateCcwNode, ArrowDown as ArrowDownNode, ArrowLeft as ArrowLeftNode,
  ArrowRight as ArrowRightNode, ExternalLink as ExternalLinkNode, ArrowUp as ArrowUpNode,
  ArrowUpRight as ArrowUpRightNode, Asterisk as AsteriskNode, Bell as BellNode,
  BookOpen as BookOpenNode, Calendar as CalendarNode, ChevronDown as ChevronDownNode,
  ChevronLeft as ChevronLeftNode, ChevronRight as ChevronRightNode, ChevronUp as ChevronUpNode,
  MessageCircle as MessageCircleNode, Check as CheckNode, CircleCheck as CircleCheckNode,
  Circle as CircleNode, CircleDot as CircleDotNode, Clock as ClockNode, Code as CodeNode,
  Compass as CompassNode, Copy as CopyNode, Ellipsis as EllipsisNode, Download as DownloadNode,
  FileText as FileTextNode, FlaskConical as FlaskConicalNode, Folder as FolderNode,
  FolderOpen as FolderOpenNode, Settings as SettingsNode, GitBranch as GitBranchNode,
  GitFork as GitForkNode, HardDrive as HardDriveNode, Hammer as HammerNode,
  Database as DatabaseNode, House as HouseNode, Info as InfoNode, Keyboard as KeyboardNode,
  Link as LinkNode, Menu as MenuNode, Search as SearchNode, Minus as MinusNode,
  SquarePen as SquarePenNode, Paintbrush as PaintbrushNode, Paperclip as PaperclipNode,
  Pause as PauseNode, Pencil as PencilNode, Play as PlayNode, Plug as PlugNode,
  Plus as PlusNode, Pin as PinNode, PinOff as PinOffNode, Bot as BotNode,
  ShieldCheck as ShieldCheckNode, PanelLeft as PanelLeftNode, PanelLeftOpen as PanelLeftOpenNode,
  PanelLeftClose as PanelLeftCloseNode, Sparkles as SparklesNode, LoaderCircle as LoaderCircleNode,
  LayoutGrid as LayoutGridNode, Square as SquareNode, Terminal as TerminalNode,
  Inbox as InboxNode, CircleUser as CircleUserNode, UserPlus as UserPlusNode,
  Users as UsersNode, CircleAlert as CircleAlertNode, X as XNode,
  Smile as SmileNode, Tag as TagNode, Tags as TagsNode, ListFilter as ListFilterNode,
  ListChecks as ListChecksNode, PanelsTopLeft as PanelsTopLeftNode, Radio as RadioNode,
  Waypoints as WaypointsNode, Shapes as ShapesNode, ScrollText as ScrollTextNode,
  ChartNoAxesCombined as ChartNoAxesCombinedNode, ReceiptText as ReceiptTextNode,
  BadgeCheck as BadgeCheckNode, ShieldUser as ShieldUserNode, KeyRound as KeyRoundNode,
  UserRound as UserRoundNode, UserRoundCog as UserRoundCogNode, Network as NetworkNode,
  Cable as CableNode, AppWindow as AppWindowNode, Webhook as WebhookNode,
  Gauge as GaugeNode, ClipboardCheck as ClipboardCheckNode, ListOrdered as ListOrderedNode,
  Route as RouteNode, TimerReset as TimerResetNode, Workflow as WorkflowNode,
  Target as TargetNode, Flag as FlagNode, NotebookPen as NotebookPenNode,
  MessageSquareText as MessageSquareTextNode, Package as PackageNode, LibraryBig as LibraryBigNode,
  SlidersHorizontal as SlidersHorizontalNode, Focus as FocusNode,
  ArchiveRestore as ArchiveRestoreNode, History as HistoryNode,
  FolderKanban as FolderKanbanNode, SquareStack as SquareStackNode,
} from "lucide";
import { currentMotionPreference } from "../lib/motion.js";
import { activateIcon, hoverShape, ICON_HOVER_SPRING, ICON_SPRING, registerIcon } from "../lib/icon-motion.js";

/** Stable SVG identity is important: swap the icon prop, not a keyed component.
 * All UI glyphs use genuine Lucide geometry and Morphicons' shared rAF driver.
 * Brand marks and custom empty-state artwork deliberately never enter here. */
export function UiIcon({ icon, size = 20, strokeWidth = 1.75, className = "", id, interactive = true, ...props }) {
  const generatedId = useId();
  const elementId = id ?? `rumbo-icon-${generatedId}`;
  const node = icon.iconNode ?? icon;
  const initial = useRef(node);
  const handle = useRef(null);
  const latest = useRef({ node, interactive, className, name: icon.iconName });
  latest.current = { node, interactive, className, name: icon.iconName };
  const cancelActivation = useRef(null);
  const previous = useRef(node);
  useLayoutEffect(() => {
    if (previous.current === node) return;
    previous.current = node;
    cancelActivation.current?.();
    if (currentMotionPreference().movement) handle.current?.morphTo(node, ICON_SPRING);
    else handle.current?.set(node);
  }, [node]);
  useLayoutEffect(() => {
    const element = document.getElementById(elementId);
    return registerIcon(element, {
      settle: () => { cancelActivation.current?.(); cancelActivation.current = null; handle.current?.set(latest.current.node); },
      activate: () => {
        const current = latest.current;
        if (!current.interactive || current.className.split(/\s+/).includes("spin")) return;
        cancelActivation.current?.();
        cancelActivation.current = activateIcon(element, handle.current, current.name, current.node);
      },
      hover: (over) => {
        const current = latest.current;
        if (!current.interactive || current.className.split(/\s+/).includes("spin")) return;
        handle.current?.morphTo(over ? hoverShape(current.node) : current.node, ICON_HOVER_SPRING);
      },
    });
  }, [elementId]);
  return <MorphIcon {...props} ref={handle} id={elementId} icon={initial.current}
    size={size} strokeWidth={strokeWidth} spring={ICON_SPRING} reducedMotion="user"
    className={`rumbo-icon ${className}`} data-rumbo-icon={icon.iconName ?? "custom"} />;
}

function defineIcon(name, node) {
  function Icon({ morphTo, ...props }) { return <UiIcon icon={morphTo ?? Icon} {...props} />; }
  Icon.displayName = name;
  Icon.iconNode = node;
  Icon.iconName = name;
  return Icon;
}

export const Activity = defineIcon("Activity", ActivityNode);
export const Sun = defineIcon("Sun", SunNode);
export const Moon = defineIcon("Moon", MoonNode);
export const Archive = defineIcon("Archive", ArchiveNode);
export const RotateCw = defineIcon("RotateCw", RotateCwNode);
export const RotateCcw = defineIcon("RotateCcw", RotateCcwNode);
export const ArrowDown = defineIcon("ArrowDown", ArrowDownNode);
export const ArrowLeft = defineIcon("ArrowLeft", ArrowLeftNode);
export const ArrowRight = defineIcon("ArrowRight", ArrowRightNode);
export const ExternalLink = defineIcon("ExternalLink", ExternalLinkNode);
export const ArrowUp = defineIcon("ArrowUp", ArrowUpNode);
export const ArrowUpRight = defineIcon("ArrowUpRight", ArrowUpRightNode);
export const Asterisk = defineIcon("Asterisk", AsteriskNode);
export const Bell = defineIcon("Bell", BellNode);
export const BookOpen = defineIcon("BookOpen", BookOpenNode);
export const Calendar = defineIcon("Calendar", CalendarNode);
export const ChevronDown = defineIcon("ChevronDown", ChevronDownNode);
export const ChevronLeft = defineIcon("ChevronLeft", ChevronLeftNode);
export const ChevronRight = defineIcon("ChevronRight", ChevronRightNode);
export const ChevronUp = defineIcon("ChevronUp", ChevronUpNode);
export const MessageCircle = defineIcon("MessageCircle", MessageCircleNode);
export const Check = defineIcon("Check", CheckNode);
export const CircleCheck = defineIcon("CircleCheck", CircleCheckNode);
export const Circle = defineIcon("Circle", CircleNode);
export const CircleDot = defineIcon("CircleDot", CircleDotNode);
export const Clock = defineIcon("Clock", ClockNode);
export const Code = defineIcon("Code", CodeNode);
export const Compass = defineIcon("Compass", CompassNode);
export const Copy = defineIcon("Copy", CopyNode);
export const Ellipsis = defineIcon("Ellipsis", EllipsisNode);
export const Download = defineIcon("Download", DownloadNode);
export const FileText = defineIcon("FileText", FileTextNode);
export const FlaskConical = defineIcon("FlaskConical", FlaskConicalNode);
export const Folder = defineIcon("Folder", FolderNode);
export const FolderOpen = defineIcon("FolderOpen", FolderOpenNode);
export const Settings = defineIcon("Settings", SettingsNode);
export const GitBranch = defineIcon("GitBranch", GitBranchNode);
// Lucide v1 deliberately has no company logos. Provider names remain explicit;
// these are repository/storage symbols, not counterfeit GitHub/Drive logos.
export const GitFork = defineIcon("GitFork", GitForkNode);
export const HardDrive = defineIcon("HardDrive", HardDriveNode);
export const Hammer = defineIcon("Hammer", HammerNode);
export const Database = defineIcon("Database", DatabaseNode);
export const House = defineIcon("House", HouseNode);
export const Info = defineIcon("Info", InfoNode);
export const Keyboard = defineIcon("Keyboard", KeyboardNode);
export const Link = defineIcon("Link", LinkNode);
export const Menu = defineIcon("Menu", MenuNode);
export const Search = defineIcon("Search", SearchNode);
export const Minus = defineIcon("Minus", MinusNode);
export const SquarePen = defineIcon("SquarePen", SquarePenNode);
export const Paintbrush = defineIcon("Paintbrush", PaintbrushNode);
export const Paperclip = defineIcon("Paperclip", PaperclipNode);
export const Pause = defineIcon("Pause", PauseNode);
export const Pencil = defineIcon("Pencil", PencilNode);
export const Play = defineIcon("Play", PlayNode);
export const Plug = defineIcon("Plug", PlugNode);
export const Plus = defineIcon("Plus", PlusNode);
export const Pin = defineIcon("Pin", PinNode);
export const PinOff = defineIcon("PinOff", PinOffNode);
export const Bot = defineIcon("Bot", BotNode);
export const ShieldCheck = defineIcon("ShieldCheck", ShieldCheckNode);
export const PanelLeft = defineIcon("PanelLeft", PanelLeftNode);
export const PanelLeftOpen = defineIcon("PanelLeftOpen", PanelLeftOpenNode);
export const PanelLeftClose = defineIcon("PanelLeftClose", PanelLeftCloseNode);
export const Sparkles = defineIcon("Sparkles", SparklesNode);
export const LoaderCircle = defineIcon("LoaderCircle", LoaderCircleNode);
export const LayoutGrid = defineIcon("LayoutGrid", LayoutGridNode);
export const Square = defineIcon("Square", SquareNode);
export const Terminal = defineIcon("Terminal", TerminalNode);
export const Inbox = defineIcon("Inbox", InboxNode);
export const CircleUser = defineIcon("CircleUser", CircleUserNode);
export const UserPlus = defineIcon("UserPlus", UserPlusNode);
export const Users = defineIcon("Users", UsersNode);
export const CircleAlert = defineIcon("CircleAlert", CircleAlertNode);
export const X = defineIcon("X", XNode);
export const Smile = defineIcon("Smile", SmileNode);
export const Tag = defineIcon("Tag", TagNode);
export const Tags = defineIcon("Tags", TagsNode);
export const ListFilter = defineIcon("ListFilter", ListFilterNode);
export const ListChecks = defineIcon("ListChecks", ListChecksNode);
export const PanelsTopLeft = defineIcon("PanelsTopLeft", PanelsTopLeftNode);
export const Radio = defineIcon("Radio", RadioNode);
export const Waypoints = defineIcon("Waypoints", WaypointsNode);
export const Shapes = defineIcon("Shapes", ShapesNode);
export const ScrollText = defineIcon("ScrollText", ScrollTextNode);
export const ChartNoAxesCombined = defineIcon("ChartNoAxesCombined", ChartNoAxesCombinedNode);
export const ReceiptText = defineIcon("ReceiptText", ReceiptTextNode);
export const BadgeCheck = defineIcon("BadgeCheck", BadgeCheckNode);
export const ShieldUser = defineIcon("ShieldUser", ShieldUserNode);
export const KeyRound = defineIcon("KeyRound", KeyRoundNode);
export const UserRound = defineIcon("UserRound", UserRoundNode);
export const UserRoundCog = defineIcon("UserRoundCog", UserRoundCogNode);
export const Network = defineIcon("Network", NetworkNode);
export const Cable = defineIcon("Cable", CableNode);
export const AppWindow = defineIcon("AppWindow", AppWindowNode);
export const Webhook = defineIcon("Webhook", WebhookNode);
export const Gauge = defineIcon("Gauge", GaugeNode);
export const ClipboardCheck = defineIcon("ClipboardCheck", ClipboardCheckNode);
export const ListOrdered = defineIcon("ListOrdered", ListOrderedNode);
export const Route = defineIcon("Route", RouteNode);
export const TimerReset = defineIcon("TimerReset", TimerResetNode);
export const Workflow = defineIcon("Workflow", WorkflowNode);
export const Target = defineIcon("Target", TargetNode);
export const Flag = defineIcon("Flag", FlagNode);
export const NotebookPen = defineIcon("NotebookPen", NotebookPenNode);
export const MessageSquareText = defineIcon("MessageSquareText", MessageSquareTextNode);
export const Package = defineIcon("Package", PackageNode);
export const LibraryBig = defineIcon("LibraryBig", LibraryBigNode);
export const SlidersHorizontal = defineIcon("SlidersHorizontal", SlidersHorizontalNode);
export const Focus = defineIcon("Focus", FocusNode);
export const ArchiveRestore = defineIcon("ArchiveRestore", ArchiveRestoreNode);
export const History = defineIcon("History", HistoryNode);
export const FolderKanban = defineIcon("FolderKanban", FolderKanbanNode);
export const SquareStack = defineIcon("SquareStack", SquareStackNode);
