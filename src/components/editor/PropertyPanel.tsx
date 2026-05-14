import { useMemo, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignHorizontalDistributeCenter,
  AlignHorizontalSpaceBetween,
  AlignVerticalDistributeCenter,
  AlignVerticalSpaceBetween,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { useEditor } from "../../store/editorStore";
import {
  computeLayerBbox,
  getLayerAnchor,
  listLayers,
} from "../../lib/projectIO";
import { SCREEN_H, SCREEN_W } from "../../types/face";
import AssetCard from "./AssetCard";
import AssetDetailView from "./AssetDetailView";
import Tooltip from "../Tooltip";
import type { FaceN } from "../../lib/faceN";
import type { EditorProject, GuideLine } from "../../types/face";
import type { DummyStateN } from "../../lib/renderFaceN";

type FNEl = FaceN["elements"][number];

const NumField = ({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number | null;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) => (
  <label className="prop-field">
    <span>{label}</span>
    <input
      type="number"
      value={value ?? ""}
      min={min}
      max={max}
      disabled={disabled || value === null}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  </label>
);

const SelectField = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: { value: number; label: string }[];
  onChange: (n: number) => void;
}) => (
  <label className="prop-field">
    <span>{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
);

// ---------- FaceN kind-specific subforms ----------

function FaceNFields({ idx, el }: { idx: number; el: FNEl }) {
  const patch = useEditor((s) => s.patchElement);
  const setLayerPosition = useEditor((s) => s.setLayerPosition);

  const alignOptions = [
    { value: 0, label: "L" },
    { value: 1, label: "R" },
    { value: 2, label: "C" },
  ];
  const alignToNum = (a: "L" | "R" | "C") =>
    a === "R" ? 1 : a === "C" ? 2 : 0;
  const numToAlign = (n: number): "L" | "R" | "C" =>
    n === 1 ? "R" : n === 2 ? "C" : "L";

  switch (el.kind) {
    case "Image":
    case "TimeHand":
    case "DayName":
    case "BatteryFill":
    case "HeartRateNum":
    case "StepsNum":
    case "KCalNum":
    case "BarDisplay":
    case "Weather": {
      const xField = (
        <div className="prop-row" key="xy">
          <NumField
            label="x"
            value={el.x}
            onChange={(x) => setLayerPosition(idx, x, el.y)}
            min={-SCREEN_W}
            max={SCREEN_W * 2}
          />
          <NumField
            label="y"
            value={el.y}
            onChange={(y) => setLayerPosition(idx, el.x, y)}
            min={-SCREEN_H}
            max={SCREEN_H * 2}
          />
        </div>
      );
      const rest: React.ReactNode[] = [];
      if (el.kind === "TimeHand") {
        rest.push(
          <SelectField
            key="htype"
            label="h_type"
            value={el.hType}
            options={[
              { value: 0, label: "0 — hour" },
              { value: 1, label: "1 — minute" },
              { value: 2, label: "2 — second" },
            ]}
            onChange={(hType) => patch(idx, { hType } as Partial<FNEl>)}
          />,
          <div className="prop-row" key="pivot">
            <NumField
              label="pivotX"
              value={el.pivotX}
              onChange={(pivotX) => patch(idx, { pivotX } as Partial<FNEl>)}
            />
            <NumField
              label="pivotY"
              value={el.pivotY}
              onChange={(pivotY) => patch(idx, { pivotY } as Partial<FNEl>)}
            />
          </div>,
        );
      }
      if (el.kind === "DayName") {
        rest.push(
          <NumField
            key="ntype"
            label="n_type"
            value={el.nType}
            onChange={(nType) => patch(idx, { nType } as Partial<FNEl>)}
          />,
        );
      }
      if (el.kind === "BatteryFill") {
        rest.push(
          <div className="prop-row" key="x1y1">
            <NumField
              label="x1"
              value={el.x1}
              onChange={(x1) => patch(idx, { x1 } as Partial<FNEl>)}
            />
            <NumField
              label="y1"
              value={el.y1}
              onChange={(y1) => patch(idx, { y1 } as Partial<FNEl>)}
            />
          </div>,
          <div className="prop-row" key="x2y2">
            <NumField
              label="x2"
              value={el.x2}
              onChange={(x2) => patch(idx, { x2 } as Partial<FNEl>)}
            />
            <NumField
              label="y2"
              value={el.y2}
              onChange={(y2) => patch(idx, { y2 } as Partial<FNEl>)}
            />
          </div>,
        );
      }
      if (
        el.kind === "HeartRateNum" ||
        el.kind === "StepsNum" ||
        el.kind === "KCalNum"
      ) {
        rest.push(
          <NumField
            key="digitSet"
            label="digit_set"
            value={el.digitSet}
            onChange={(digitSet) => patch(idx, { digitSet } as Partial<FNEl>)}
            min={0}
          />,
          <SelectField
            key="align"
            label="align"
            value={alignToNum(el.align)}
            options={alignOptions}
            onChange={(n) =>
              patch(idx, { align: numToAlign(n) } as Partial<FNEl>)
            }
          />,
        );
      }
      if (el.kind === "BarDisplay") {
        rest.push(
          <SelectField
            key="btype"
            label="b_type"
            value={el.bType}
            options={[
              { value: 0, label: "0 — Steps" },
              { value: 2, label: "2 — KCal" },
              { value: 5, label: "5 — HeartRate" },
              { value: 6, label: "6 — Battery" },
            ]}
            onChange={(bType) => patch(idx, { bType } as Partial<FNEl>)}
          />,
          <NumField
            key="count"
            label="count"
            value={el.count}
            onChange={() => {}}
            disabled
          />,
        );
      }
      if (el.kind === "Weather") {
        rest.push(
          <NumField
            key="count"
            label="count"
            value={el.count}
            onChange={() => {}}
            disabled
          />,
        );
      }
      return (
        <>
          {xField}
          {rest}
        </>
      );
    }
    case "TimeNum":
      return (
        <p className="hint">
          TimeNum has 4 digit slots (HH:MM). Per-slot positioning + digit-set
          binding lands with the font generator (Phase 3).
        </p>
      );
    case "DayNum":
    case "MonthNum":
      return (
        <>
          <NumField
            label="digit_set"
            value={el.digitSet}
            onChange={(digitSet) => patch(idx, { digitSet } as Partial<FNEl>)}
            min={0}
          />
          <SelectField
            label="align"
            value={alignToNum(el.align)}
            options={alignOptions}
            onChange={(n) =>
              patch(idx, { align: numToAlign(n) } as Partial<FNEl>)
            }
          />
        </>
      );
    case "Dash":
      return (
        <p className="hint">Dash holds a single image; edit it under Assets.</p>
      );
    case "Unknown29":
    case "Unknown":
      return <p className="hint">Read-only kind.</p>;
  }
}

type AlignAxis = "left" | "centerH" | "right" | "top" | "centerV" | "bottom";

/** Snap the layer to a canvas edge or centre. Uses the renderer-accurate
 *  bbox (which expands for multi-digit types) so centring an aligned digit
 *  set lands on the middle of all the digits, not just the first slot. */
function AlignmentRow({ idx }: { idx: number }) {
  const project = useEditor((s) => s.project);
  const dummy = useEditor((s) => s.dummy);
  const setLayerPosition = useEditor((s) => s.setLayerPosition);
  if (!project) return null;

  const bbox = computeLayerBbox(project, idx, dummy);
  const anchorX =
    project.format === "typeC" ? project.layers[idx]?.x : null;
  const anchorY =
    project.format === "typeC" ? project.layers[idx]?.y : null;
  const disabled =
    !bbox || anchorX === null || anchorX === undefined || anchorY === null || anchorY === undefined;

  const align = (axis: AlignAxis) => {
    if (!bbox || anchorX == null || anchorY == null) return;
    // bbox.x is where the layer paints; layer.x is its anchor. For
    // left-aligned layers they're equal, for centred/right multi-digit
    // they differ. We move by the *delta* from current bbox to target so
    // multi-digit alignment behaves correctly.
    let nextX = anchorX;
    let nextY = anchorY;
    switch (axis) {
      case "left":
        nextX = anchorX + (0 - bbox.x);
        break;
      case "centerH":
        nextX = anchorX + (Math.round((SCREEN_W - bbox.w) / 2) - bbox.x);
        break;
      case "right":
        nextX = anchorX + (SCREEN_W - bbox.w - bbox.x);
        break;
      case "top":
        nextY = anchorY + (0 - bbox.y);
        break;
      case "centerV":
        nextY = anchorY + (Math.round((SCREEN_H - bbox.h) / 2) - bbox.y);
        break;
      case "bottom":
        nextY = anchorY + (SCREEN_H - bbox.h - bbox.y);
        break;
    }
    setLayerPosition(idx, nextX, nextY);
  };

  return (
    <div className="prop-alignment-row" role="group" aria-label="Align layer">
      <Tooltip content="Align left (x = 0)">
        <button
          type="button"
          className="icon-btn"
          onClick={() => align("left")}
          disabled={disabled}
        >
          <AlignStartVertical size={14} aria-hidden />
        </button>
      </Tooltip>
      <Tooltip content="Centre horizontally">
        <button
          type="button"
          className="icon-btn"
          onClick={() => align("centerH")}
          disabled={disabled}
        >
          <AlignCenterVertical size={14} aria-hidden />
        </button>
      </Tooltip>
      <Tooltip content={`Align right (x = ${SCREEN_W} − width)`}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => align("right")}
          disabled={disabled}
        >
          <AlignEndVertical size={14} aria-hidden />
        </button>
      </Tooltip>
      <span className="prop-alignment-sep" aria-hidden />
      <Tooltip content="Align top (y = 0)">
        <button
          type="button"
          className="icon-btn"
          onClick={() => align("top")}
          disabled={disabled}
        >
          <AlignStartHorizontal size={14} aria-hidden />
        </button>
      </Tooltip>
      <Tooltip content="Centre vertically">
        <button
          type="button"
          className="icon-btn"
          onClick={() => align("centerV")}
          disabled={disabled}
        >
          <AlignCenterHorizontal size={14} aria-hidden />
        </button>
      </Tooltip>
      <Tooltip content={`Align bottom (y = ${SCREEN_H} − height)`}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => align("bottom")}
          disabled={disabled}
        >
          <AlignEndHorizontal size={14} aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}

/** Property panel content for a single selected guide. Lets the user
 *  retune position, flip per-guide visibility, snap to canvas extremes,
 *  and delete. Multi-guide selection goes through `MultiArrangeRow` like
 *  layers do. */
function GuideFields({ guide }: { guide: GuideLine }) {
  const moveGuideAction = useEditor((s) => s.moveGuideAction);
  const setGuideVisibleAction = useEditor((s) => s.setGuideVisibleAction);
  const deleteSelectedGuides = useEditor((s) => s.deleteSelectedGuides);

  const max = guide.axis === "H" ? SCREEN_H : SCREEN_W;
  const axisLabel = guide.axis === "H" ? "Horizontal" : "Vertical";
  const posLabel = guide.axis === "H" ? "y" : "x";

  return (
    <>
      <p className="prop-meta">
        {axisLabel} guide · {posLabel} = {guide.position}
      </p>
      <NumField
        label={posLabel}
        value={guide.position}
        onChange={(n) => moveGuideAction(guide.id, n)}
        min={0}
        max={max}
      />
      <div className="prop-alignment-row" role="group" aria-label="Snap guide">
        <Tooltip content={`Snap to ${posLabel} = 0`}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => moveGuideAction(guide.id, 0)}
          >
            {guide.axis === "H" ? (
              <AlignStartHorizontal size={14} aria-hidden />
            ) : (
              <AlignStartVertical size={14} aria-hidden />
            )}
          </button>
        </Tooltip>
        <Tooltip content={`Snap to centre (${posLabel} = ${max / 2})`}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => moveGuideAction(guide.id, max / 2)}
          >
            {guide.axis === "H" ? (
              <AlignCenterHorizontal size={14} aria-hidden />
            ) : (
              <AlignCenterVertical size={14} aria-hidden />
            )}
          </button>
        </Tooltip>
        <Tooltip content={`Snap to ${posLabel} = ${max}`}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => moveGuideAction(guide.id, max)}
          >
            {guide.axis === "H" ? (
              <AlignEndHorizontal size={14} aria-hidden />
            ) : (
              <AlignEndVertical size={14} aria-hidden />
            )}
          </button>
        </Tooltip>
      </div>
      <Tooltip
        content={guide.visible ? "Hide this guide" : "Show this guide"}
      >
        <button
          type="button"
          className="counter ghost"
          onClick={() => setGuideVisibleAction(guide.id, !guide.visible)}
        >
          {guide.visible ? (
            <Eye size={14} aria-hidden />
          ) : (
            <EyeOff size={14} aria-hidden />
          )}
          {guide.visible ? "Visible" : "Hidden"}
        </button>
      </Tooltip>
      <button
        type="button"
        className="counter ghost danger prop-delete"
        onClick={() => deleteSelectedGuides()}
      >
        <Trash2 size={14} aria-hidden />
        Delete guide
      </button>
    </>
  );
}

/** Align / distribute / delete row for a multi-guide selection. Each axis
 *  has its own controls because alignment only makes sense within a single
 *  axis (you can't align a horizontal and vertical guide to the same
 *  "top"). Mixed-axis selections show controls for both — disabled buttons
 *  fade out when the relevant axis doesn't have enough guides. */
function MultiGuideArrangeRow({ guides }: { guides: GuideLine[] }) {
  const moveGuideAction = useEditor((s) => s.moveGuideAction);

  const horizontal = guides.filter((g) => g.axis === "H");
  const vertical = guides.filter((g) => g.axis === "V");

  // Align — snap a list to a single canvas-relative position.
  const alignTo = (axis: "H" | "V", target: number) => {
    const list = axis === "H" ? horizontal : vertical;
    for (const g of list) moveGuideAction(g.id, target);
  };

  // Distribute — pin extremes, evenly space middle entries. Guides have
  // zero extent so "equal gaps" == "equal centres" — a single function
  // covers both interpretations.
  const distribute = (axis: "H" | "V") => {
    const list = axis === "H" ? horizontal : vertical;
    if (list.length < 3) return;
    const sorted = [...list].sort((a, b) => a.position - b.position);
    const first = sorted[0].position;
    const last = sorted[sorted.length - 1].position;
    const step = (last - first) / (sorted.length - 1);
    for (let i = 1; i < sorted.length - 1; i++) {
      moveGuideAction(sorted[i].id, Math.round(first + step * i));
    }
  };

  // A row is shown when at least one matching-axis guide is selected.
  // 2+ are needed for align to be meaningful (snapping one already happens
  // via single-guide controls); 3+ for distribute.
  const showH = horizontal.length >= 1;
  const showV = vertical.length >= 1;
  const canAlignH = horizontal.length >= 2;
  const canAlignV = vertical.length >= 2;
  const canDistH = horizontal.length >= 3;
  const canDistV = vertical.length >= 3;

  return (
    <>
      {showH && (
        <div
          className="prop-alignment-row"
          role="group"
          aria-label="Horizontal guides — align Y"
        >
          <span className="prop-alignment-axis-label">{horizontal.length}H</span>
          <Tooltip content="Align to top (y = 0)">
            <button
              type="button"
              className="icon-btn"
              onClick={() => alignTo("H", 0)}
              disabled={!canAlignH}
            >
              <AlignStartHorizontal size={14} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content="Align to centre (y = 120)">
            <button
              type="button"
              className="icon-btn"
              onClick={() => alignTo("H", SCREEN_H / 2)}
              disabled={!canAlignH}
            >
              <AlignCenterHorizontal size={14} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content={`Align to bottom (y = ${SCREEN_H})`}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => alignTo("H", SCREEN_H)}
              disabled={!canAlignH}
            >
              <AlignEndHorizontal size={14} aria-hidden />
            </button>
          </Tooltip>
          <span className="prop-alignment-sep" aria-hidden />
          <Tooltip
            content={
              canDistH
                ? "Distribute vertically (equal spacing)"
                : "Distribute needs 3+ horizontal guides"
            }
          >
            <button
              type="button"
              className="icon-btn"
              onClick={() => distribute("H")}
              disabled={!canDistH}
            >
              <AlignVerticalDistributeCenter size={14} aria-hidden />
            </button>
          </Tooltip>
        </div>
      )}
      {showV && (
        <div
          className="prop-alignment-row"
          role="group"
          aria-label="Vertical guides — align X"
        >
          <span className="prop-alignment-axis-label">{vertical.length}V</span>
          <Tooltip content="Align to left (x = 0)">
            <button
              type="button"
              className="icon-btn"
              onClick={() => alignTo("V", 0)}
              disabled={!canAlignV}
            >
              <AlignStartVertical size={14} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content="Align to centre (x = 120)">
            <button
              type="button"
              className="icon-btn"
              onClick={() => alignTo("V", SCREEN_W / 2)}
              disabled={!canAlignV}
            >
              <AlignCenterVertical size={14} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content={`Align to right (x = ${SCREEN_W})`}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => alignTo("V", SCREEN_W)}
              disabled={!canAlignV}
            >
              <AlignEndVertical size={14} aria-hidden />
            </button>
          </Tooltip>
          <span className="prop-alignment-sep" aria-hidden />
          <Tooltip
            content={
              canDistV
                ? "Distribute horizontally (equal spacing)"
                : "Distribute needs 3+ vertical guides"
            }
          >
            <button
              type="button"
              className="icon-btn"
              onClick={() => distribute("V")}
              disabled={!canDistV}
            >
              <AlignHorizontalDistributeCenter size={14} aria-hidden />
            </button>
          </Tooltip>
        </div>
      )}
    </>
  );
}

function TypeCFields({ idx }: { idx: number }) {
  const project = useEditor((s) => s.project);
  const setLayerPosition = useEditor((s) => s.setLayerPosition);
  if (!project || project.format !== "typeC") return null;
  const layer = project.layers[idx];
  if (!layer) return null;
  const set = project.assetSets.find((s) => s.id === layer.assetSetId);
  return (
    <>
      <div className="prop-row">
        <NumField
          label="x"
          value={layer.x}
          onChange={(x) => setLayerPosition(idx, x, layer.y)}
          min={-SCREEN_W}
          max={SCREEN_W * 2}
        />
        <NumField
          label="y"
          value={layer.y}
          onChange={(y) => setLayerPosition(idx, layer.x, y)}
          min={-SCREEN_H}
          max={SCREEN_H * 2}
        />
      </div>
      <AlignmentRow idx={idx} />
      <div className="prop-row">
        <NumField
          label="w"
          value={set?.width ?? 0}
          onChange={() => {}}
          disabled
        />
        <NumField
          label="h"
          value={set?.height ?? 0}
          onChange={() => {}}
          disabled
        />
      </div>
    </>
  );
}

type MultiBbox = { idx: number; x: number; y: number; w: number; h: number };

const collectMultiBboxes = (
  project: EditorProject,
  idxs: number[],
  dummy: DummyStateN,
): MultiBbox[] => {
  const out: MultiBbox[] = [];
  for (const idx of idxs) {
    const bb = computeLayerBbox(project, idx, dummy);
    if (bb) out.push({ idx, ...bb });
  }
  return out;
};

type RelativeTo = "selection" | "canvas" | "first";

/** Arrange + distribute. `Relative to` picks the reference rect that
 *  alignment targets snap to:
 *    - selection: the union bounding rect of every selected layer (default)
 *    - canvas:    the 240×240 watch face
 *    - first:     the bbox of the first-selected layer (idxs[0])
 *  Distribute is always relative to the selection's extremes — it doesn't
 *  make sense against a fixed rect. */
function MultiArrangeRow({ idxs }: { idxs: number[] }) {
  const project = useEditor((s) => s.project);
  const dummy = useEditor((s) => s.dummy);
  const setLayerPosition = useEditor((s) => s.setLayerPosition);
  const [relativeTo, setRelativeTo] = useState<RelativeTo>("selection");
  if (!project) return null;

  const bboxes = collectMultiBboxes(project, idxs, dummy);

  // Reference rect varies by mode. Computed up-front so the alignment
  // closures below stay one-liners.
  let refRect: { x: number; y: number; w: number; h: number } | null = null;
  if (bboxes.length > 0) {
    if (relativeTo === "canvas") {
      refRect = { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H };
    } else if (relativeTo === "first") {
      // idxs[0] is the anchor (first-selected). Find its bbox in the
      // computed list — falls back to selection if it has no bbox.
      const firstBb = bboxes.find((b) => b.idx === idxs[0]);
      refRect = firstBb
        ? { x: firstBb.x, y: firstBb.y, w: firstBb.w, h: firstBb.h }
        : null;
    }
    if (!refRect) {
      const minX = Math.min(...bboxes.map((b) => b.x));
      const minY = Math.min(...bboxes.map((b) => b.y));
      const maxX = Math.max(...bboxes.map((b) => b.x + b.w));
      const maxY = Math.max(...bboxes.map((b) => b.y + b.h));
      refRect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
  const minX = refRect?.x ?? 0;
  const minY = refRect?.y ?? 0;
  const maxX = (refRect?.x ?? 0) + (refRect?.w ?? 0);
  const maxY = (refRect?.y ?? 0) + (refRect?.h ?? 0);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const moveTo = (newX: number, newY: number, bb: MultiBbox) => {
    const anchor = getLayerAnchor(project, bb.idx);
    if (!anchor) return;
    // The anchor (layer.x/y) and the bbox.x/y can differ for centred or
    // right-aligned multi-digit Type C layers, so move by delta.
    setLayerPosition(
      bb.idx,
      anchor.x + Math.round(newX - bb.x),
      anchor.y + Math.round(newY - bb.y),
    );
  };

  const alignL = () => bboxes.forEach((bb) => moveTo(minX, bb.y, bb));
  const alignCH = () =>
    bboxes.forEach((bb) => moveTo(centerX - bb.w / 2, bb.y, bb));
  const alignR = () => bboxes.forEach((bb) => moveTo(maxX - bb.w, bb.y, bb));
  const alignT = () => bboxes.forEach((bb) => moveTo(bb.x, minY, bb));
  const alignCV = () =>
    bboxes.forEach((bb) => moveTo(bb.x, centerY - bb.h / 2, bb));
  const alignB = () => bboxes.forEach((bb) => moveTo(bb.x, maxY - bb.h, bb));

  // Two flavours of distribute, matching what design tools call
  // "equal gaps" and "equal centres" (Figma's "Distribute spacing" vs
  // "Tidy up"; Inkscape lists both separately). For uniformly-sized
  // layers they produce identical results; for mixed sizes they differ.
  //
  //  - Equal gaps:    constant whitespace between adjacent bboxes
  //  - Equal centres: constant centre-to-centre distance
  //
  // Both keep the leftmost and rightmost layers anchored.
  const distGapsH = () => {
    if (bboxes.length < 3) return;
    const sorted = [...bboxes].sort((a, b) => a.x - b.x);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalSpan = last.x + last.w - first.x;
    const sumW = sorted.reduce((acc, b) => acc + b.w, 0);
    const gap = (totalSpan - sumW) / (sorted.length - 1);
    let cursor = first.x;
    sorted.forEach((bb, i) => {
      if (i > 0 && i < sorted.length - 1) {
        moveTo(cursor, bb.y, bb);
      }
      cursor += bb.w + gap;
    });
  };
  const distGapsV = () => {
    if (bboxes.length < 3) return;
    const sorted = [...bboxes].sort((a, b) => a.y - b.y);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalSpan = last.y + last.h - first.y;
    const sumH = sorted.reduce((acc, b) => acc + b.h, 0);
    const gap = (totalSpan - sumH) / (sorted.length - 1);
    let cursor = first.y;
    sorted.forEach((bb, i) => {
      if (i > 0 && i < sorted.length - 1) {
        moveTo(bb.x, cursor, bb);
      }
      cursor += bb.h + gap;
    });
  };
  const distCentersH = () => {
    if (bboxes.length < 3) return;
    const sorted = [...bboxes]
      .map((b) => ({ bb: b, c: b.x + b.w / 2 }))
      .sort((a, b) => a.c - b.c);
    const firstC = sorted[0].c;
    const lastC = sorted[sorted.length - 1].c;
    const step = (lastC - firstC) / (sorted.length - 1);
    sorted.forEach((item, i) => {
      if (i === 0 || i === sorted.length - 1) return;
      const targetCenter = firstC + step * i;
      moveTo(targetCenter - item.bb.w / 2, item.bb.y, item.bb);
    });
  };
  const distCentersV = () => {
    if (bboxes.length < 3) return;
    const sorted = [...bboxes]
      .map((b) => ({ bb: b, c: b.y + b.h / 2 }))
      .sort((a, b) => a.c - b.c);
    const firstC = sorted[0].c;
    const lastC = sorted[sorted.length - 1].c;
    const step = (lastC - firstC) / (sorted.length - 1);
    sorted.forEach((item, i) => {
      if (i === 0 || i === sorted.length - 1) return;
      const targetCenter = firstC + step * i;
      moveTo(item.bb.x, targetCenter - item.bb.h / 2, item.bb);
    });
  };

  const disabled = bboxes.length < 2;
  const distDisabled = bboxes.length < 3;

  return (
    <>
      <p className="prop-meta">
        {bboxes.length} of {idxs.length} layer{idxs.length === 1 ? "" : "s"}
        {bboxes.length < idxs.length && " arrangeable"}
      </p>
      <label className="prop-relative">
        <span>Relative to</span>
        <select
          value={relativeTo}
          onChange={(e) => setRelativeTo(e.target.value as RelativeTo)}
        >
          <option value="selection">Selection</option>
          <option value="canvas">Canvas (240×240)</option>
          <option value="first">First selected</option>
        </select>
      </label>
      <div
        className="prop-alignment-row"
        role="group"
        aria-label="Align selection"
      >
        <Tooltip content="Align left edges">
          <button
            type="button"
            className="icon-btn"
            onClick={alignL}
            disabled={disabled}
          >
            <AlignStartVertical size={14} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip content="Align horizontal centres">
          <button
            type="button"
            className="icon-btn"
            onClick={alignCH}
            disabled={disabled}
          >
            <AlignCenterVertical size={14} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip content="Align right edges">
          <button
            type="button"
            className="icon-btn"
            onClick={alignR}
            disabled={disabled}
          >
            <AlignEndVertical size={14} aria-hidden />
          </button>
        </Tooltip>
        <span className="prop-alignment-sep" aria-hidden />
        <Tooltip content="Align top edges">
          <button
            type="button"
            className="icon-btn"
            onClick={alignT}
            disabled={disabled}
          >
            <AlignStartHorizontal size={14} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip content="Align vertical centres">
          <button
            type="button"
            className="icon-btn"
            onClick={alignCV}
            disabled={disabled}
          >
            <AlignCenterHorizontal size={14} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip content="Align bottom edges">
          <button
            type="button"
            className="icon-btn"
            onClick={alignB}
            disabled={disabled}
          >
            <AlignEndHorizontal size={14} aria-hidden />
          </button>
        </Tooltip>
      </div>
      <div
        className="prop-alignment-row"
        role="group"
        aria-label="Distribute selection"
      >
        <Tooltip
          content={
            distDisabled
              ? "Equal horizontal gaps (needs 3+ layers)"
              : "Equal horizontal gaps"
          }
        >
          <button
            type="button"
            className="icon-btn"
            onClick={distGapsH}
            disabled={distDisabled}
          >
            <AlignHorizontalSpaceBetween size={14} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip
          content={
            distDisabled
              ? "Distribute horizontal centres (needs 3+ layers)"
              : "Distribute horizontal centres"
          }
        >
          <button
            type="button"
            className="icon-btn"
            onClick={distCentersH}
            disabled={distDisabled}
          >
            <AlignHorizontalDistributeCenter size={14} aria-hidden />
          </button>
        </Tooltip>
        <span className="prop-alignment-sep" aria-hidden />
        <Tooltip
          content={
            distDisabled
              ? "Equal vertical gaps (needs 3+ layers)"
              : "Equal vertical gaps"
          }
        >
          <button
            type="button"
            className="icon-btn"
            onClick={distGapsV}
            disabled={distDisabled}
          >
            <AlignVerticalSpaceBetween size={14} aria-hidden />
          </button>
        </Tooltip>
        <Tooltip
          content={
            distDisabled
              ? "Distribute vertical centres (needs 3+ layers)"
              : "Distribute vertical centres"
          }
        >
          <button
            type="button"
            className="icon-btn"
            onClick={distCentersV}
            disabled={distDisabled}
          >
            <AlignVerticalDistributeCenter size={14} aria-hidden />
          </button>
        </Tooltip>
      </div>
    </>
  );
}

function PropertyPanel() {
  const project = useEditor((s) => s.project);
  const selectedIdxs = useEditor((s) => s.selectedIdxs);
  const selectedGuideIds = useEditor((s) => s.selectedGuideIds);
  const assetDetailId = useEditor((s) => s.assetDetailId);
  const closeAssetDetail = useEditor((s) => s.closeAssetDetail);
  const setFaceNumber = useEditor((s) => s.setFaceNumber);
  const deleteSelectedLayers = useEditor((s) => s.deleteSelectedLayers);
  const deleteSelectedGuides = useEditor((s) => s.deleteSelectedGuides);

  const onDeleteSelected = () => {
    const n = selectedIdxs.length;
    if (n === 0) return;
    // Single delete is Cmd+Z'able and low-cost; confirm only for multi.
    if (
      n > 1 &&
      !window.confirm(
        `Delete ${n} selected layer${n === 1 ? "" : "s"}? You can undo with Cmd/Ctrl+Z.`,
      )
    ) {
      return;
    }
    deleteSelectedLayers();
  };

  const layers = useMemo(() => (project ? listLayers(project) : []), [project]);
  const singleIdx = selectedIdxs.length === 1 ? selectedIdxs[0] : null;
  const layer = singleIdx !== null ? layers[singleIdx] : undefined;

  const singleGuide = useMemo(() => {
    if (!project) return null;
    if (selectedGuideIds.length !== 1) return null;
    return project.guides.find((g) => g.id === selectedGuideIds[0]) ?? null;
  }, [project, selectedGuideIds]);

  const onDeleteSelectedGuides = () => {
    const n = selectedGuideIds.length;
    if (n === 0) return;
    if (
      n > 1 &&
      !window.confirm(
        `Delete ${n} selected guide${n === 1 ? "" : "s"}? You can undo with Cmd/Ctrl+Z.`,
      )
    ) {
      return;
    }
    deleteSelectedGuides();
  };

  // Asset-detail mode takes over the sidebar entirely (replaces the layer
  // form). Only Type C carries the AssetSet model; FaceN ignores this branch.
  if (
    assetDetailId !== null &&
    project?.format === "typeC" &&
    project.assetSets.some((s) => s.id === assetDetailId)
  ) {
    return (
      <aside className="editor-pane editor-props">
        <div className="editor-pane-scroll">
          <AssetDetailView
            // Remount on set switch so all local state (draft name, local
            // error banner, font-generator target) resets cleanly. Without
            // a key change React reuses the same instance and the
            // useState initialiser only fires once.
            key={assetDetailId}
            setId={assetDetailId}
            hasLayerContext={layer !== undefined}
            onClose={closeAssetDetail}
          />
        </div>
      </aside>
    );
  }

  const typeCSet =
    layer && project?.format === "typeC"
      ? project.assetSets.find(
          (s) => s.id === project.layers[layer.index]?.assetSetId,
        )
      : undefined;

  return (
    <aside className="editor-pane editor-props">
      <div className="editor-pane-scroll">
        <h3>Project</h3>
        {project?.format === "typeC" && (
          <NumField
            label="faceNumber"
            value={project.faceNumber}
            onChange={(n) => setFaceNumber(n)}
            min={1}
          />
        )}
        {project?.format === "faceN" && (
          <p className="hint">
            FaceN binaries don't carry a faceNumber — the device slot is decided
            at upload time.
          </p>
        )}

        {selectedIdxs.length === 0 && selectedGuideIds.length === 0 && (
          <p className="hint">
            Select a layer to edit its properties. Shift- or Cmd/Ctrl-click
            to multi-select, or drag on empty canvas to marquee-select.
          </p>
        )}

        {selectedIdxs.length > 1 && (
          <>
            <h3>
              {selectedIdxs.length} layers selected
            </h3>
            <MultiArrangeRow idxs={selectedIdxs} />
            <button
              type="button"
              className="counter ghost danger prop-delete"
              onClick={onDeleteSelected}
            >
              <Trash2 size={14} aria-hidden />
              Delete {selectedIdxs.length} layers
            </button>
          </>
        )}

        {singleGuide && (
          <>
            <h3>Guide</h3>
            <GuideFields guide={singleGuide} />
          </>
        )}

        {selectedGuideIds.length > 1 && project && (() => {
          // Look up the GuideLine objects for the selected ids; defensively
          // skip any that no longer exist (race against a delete from
          // another surface).
          const guides = selectedGuideIds
            .map((id) => project.guides.find((g) => g.id === id))
            .filter((g): g is GuideLine => g !== undefined);
          if (guides.length === 0) return null;
          return (
            <>
              <h3>{guides.length} guides selected</h3>
              <MultiGuideArrangeRow guides={guides} />
              <button
                type="button"
                className="counter ghost danger prop-delete"
                onClick={onDeleteSelectedGuides}
              >
                <Trash2 size={14} aria-hidden />
                Delete {guides.length} guides
              </button>
            </>
          );
        })()}

        {layer && project && (
          <>
            <h3>Layer</h3>
            <Tooltip content={layer.name}>
              <p className="prop-meta">{layer.name}</p>
            </Tooltip>
            {project.format === "typeC" ? (
              <TypeCFields idx={layer.index} />
            ) : (
              <FaceNFields
                idx={layer.index}
                el={project.face.elements[layer.index]}
              />
            )}

            {project.format === "typeC" && typeCSet && (
              <>
                <h3>Asset library</h3>
                <AssetCard
                  project={project}
                  layerIdx={layer.index}
                  set={typeCSet}
                />
              </>
            )}

            <button
              type="button"
              className="counter ghost danger prop-delete"
              onClick={onDeleteSelected}
            >
              <Trash2 size={14} aria-hidden />
              Delete layer
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

export default PropertyPanel;
