import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import classNames from "classnames";
import { uniqueId } from "lodash";
import ResizeObserver from "resize-observer-polyfill";
import type {
  ActiveTarget,
  ComputedEdgeLineConf,
  Direction,
  EdgeCell,
  EdgeLineMotion,
  EditableLine,
  EditableLineCell,
  PositionAndAngle,
} from "./interfaces";
import {
  DEFAULT_LINE_INTERACT_ANIMATE_DURATION,
  DEFAULT_MOTION_SPEED,
} from "./constants";
import { curveLine } from "../diagram/lines/curveLine";
import { getMarkers } from "../shared/canvas/useLineMarkers";
import type {
  LineMarkerConf,
  NodePosition,
  SizeTuple,
} from "../diagram/interfaces";
import { LineLabelComponent } from "./LineLabelComponent";
import { cellToTarget } from "./processors/cellToTarget";
import { getLabelMaskAndOffset } from "./processors/getLabelMaskAndOffset";

export interface EdgeComponentProps {
  edge: EdgeCell;
  lineConfMap: WeakMap<EditableLineCell, ComputedEdgeLineConf>;
  editableLineMap: WeakMap<EditableLineCell, EditableLine>;
  readOnly?: boolean;
  active?: boolean;
  activeRelated?: boolean;
  onSwitchActiveTarget?(activeTarget: ActiveTarget | null): void;
}

export function EdgeComponent({
  edge,
  lineConfMap,
  editableLineMap,
  readOnly,
  active,
  activeRelated,
  onSwitchActiveTarget,
}: EdgeComponentProps): JSX.Element | null {
  const pathRef = useRef<SVGPathElement | null>(null);
  const lineConf = lineConfMap.get(edge)!;
  const { points: linePoints, jumpsMap } = editableLineMap.get(edge) ?? {};

  const line = useMemo(() => {
    return curveLine(
      linePoints,
      lineConf.type === "curve" ? lineConf.curveType : "curveLinear",
      0,
      1,
      jumpsMap
    );
  }, [lineConf, linePoints, jumpsMap]);

  const lineClipPathPrefix = useMemo(() => uniqueId("line-mask-"), []);

  const [labelPosition, setLabelPosition] = useState<PositionAndAngle | null>(
    null
  );
  const [labelSize, setLabelSize] = useState<SizeTuple | null>(null);
  const [lineRect, setLineRect] = useState<Pick<
    SVGRect,
    "x" | "y" | "width" | "height"
  > | null>(null);

  const updateLabelPosition = useCallback(() => {
    const path = pathRef.current;
    const { label, text } = lineConf;
    // istanbul ignore next
    if (path && linePoints && (label || text)) {
      if (process.env.NODE_ENV === "test") {
        setLabelPosition([30, 40, "center", 0, 0]);
        setLineRect({ x: 10, y: 20, width: 300, height: 400 });
        return;
      }
      const placement = (label ? label.placement : text.placement) ?? "center";
      const offset = (label ? label.offset : text.offset) ?? 0;
      const pathLength = path.getTotalLength();
      const halfPathLength = pathLength / 2;
      const pathPoint = path.getPointAtLength(
        placement === "start"
          ? 0
          : placement === "end"
            ? pathLength
            : halfPathLength + offset
      );

      let direction: Direction | "center" = "center";
      let angle = 0;
      if (placement === "start" || placement === "end") {
        let p0: NodePosition;
        let p1: NodePosition;
        if (placement === "start") {
          p0 = linePoints[0];
          p1 = linePoints[1];
        } else {
          p0 = linePoints[linePoints.length - 1];
          p1 = linePoints[linePoints.length - 2];
        }
        angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        direction =
          Math.abs(p0.x - p1.x) > Math.abs(p0.y - p1.y)
            ? p0.x > p1.x
              ? "left"
              : "right"
            : p0.y > p1.y
              ? "top"
              : "bottom";
      }

      setLabelPosition([pathPoint.x, pathPoint.y, direction, angle, offset]);
      const rect = path.getBBox();
      setLineRect({
        x: rect.x - 1000,
        y: rect.y - 1000,
        width: rect.width + 2000,
        height: rect.height + 2000,
      });
    }
  }, [lineConf, linePoints]);

  const [pathLength, setPathLength] = useState<number | null>(null);

  const pathRefCallback = useCallback(
    (element: SVGPathElement | null) => {
      pathRef.current = element;
      if (element) {
        // Jest does not support `SVGPathElement::getTotalLength`
        setPathLength(element.getTotalLength?.() ?? 100);
        const rect = element.getBBox?.();
        edge.view = {
          ...edge.view,
          x: rect?.x,
          y: rect?.y,
          width: rect?.width,
          height: rect?.height,
        };
      }
      updateLabelPosition();
    },
    [updateLabelPosition, edge]
  );

  const [labelElement, setLabelElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!labelElement) {
      setLabelSize(null);
      return;
    }
    const observerCallback = () => {
      const { offsetWidth, offsetHeight } = labelElement;
      // Do not mask out when the label takes no space.
      // istanbul ignore next
      if (
        process.env.NODE_ENV !== "test" &&
        (offsetWidth === 0 || offsetHeight === 0)
      ) {
        setLabelSize(null);
        return;
      }
      setLabelSize([offsetWidth, offsetHeight]);
    };
    const resizeObserver = new ResizeObserver(observerCallback);
    resizeObserver.observe(labelElement);

    // `ResizeObserver` will not call the callback in test environment.
    // istanbul ignore next
    if (process.env.NODE_ENV === "test") {
      observerCallback();
    }
    return () => {
      resizeObserver.disconnect();
    };
  }, [labelElement]);

  const handleLabelRendered = useCallback((element: HTMLElement | null) => {
    setLabelElement(element);
  }, []);

  useEffect(
    () => {
      updateLabelPosition();
    },
    // Update label position when line points changed
    [updateLabelPosition, linePoints]
  );

  const onLabelClick = useCallback(() => {
    onSwitchActiveTarget?.(cellToTarget(edge));
  }, [edge, onSwitchActiveTarget]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly || !lineConf.callLabelOnDoubleClick) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      (
        labelElement?.firstElementChild as unknown as Record<string, () => void>
      )?.[lineConf.callLabelOnDoubleClick]?.();
    },
    [labelElement, lineConf, readOnly]
  );

  const [mask, labelOffset] = useMemo(
    () => getLabelMaskAndOffset(labelPosition, labelSize),
    [labelPosition, labelSize]
  );

  const clipPathPoints = useMemo(() => {
    if (!mask || !lineRect) {
      return null;
    }
    const right = lineRect.x + lineRect.width;
    const bottom = lineRect.y + lineRect.height;
    const maskRight = mask.left + mask.width;
    const maskBottom = mask.top + mask.height;
    return [
      [mask.left, maskBottom],
      [maskRight, maskBottom],
      [maskRight, mask.top],
      [mask.left, mask.top],
      [mask.left, lineRect.y],
      [right, lineRect.y],
      [right, bottom],
      [lineRect.x, bottom],
      [lineRect.x, lineRect.y],
      [mask.left, lineRect.y],
    ]
      .map((points) => points.join(","))
      .join(" ");
  }, [lineRect, mask]);

  if (!line) {
    // This happens when source or target is not found,
    // or when source or target has not been positioned yet.
    return null;
  }

  let markerStart: string | undefined;
  let markerEnd: string | undefined;
  let strokeColor: string | undefined;
  let strokeWidth: number | undefined;
  let motion: EdgeLineMotion | undefined;
  const lineMarkers: LineMarkerConf[] = getMarkers(lineConf);
  if (active) {
    const overrides = lineConf.overrides?.active;
    strokeColor = overrides?.strokeColor ?? lineConf.strokeColor;
    strokeWidth = overrides?.strokeWidth ?? lineConf.strokeWidth;
    motion = overrides?.motion;
    for (const marker of lineMarkers) {
      if (marker.placement === "start") {
        markerStart =
          lineConf.$activeMarkerStartUrl ?? lineConf.$markerStartUrl;
      } else {
        markerEnd = lineConf.$activeMarkerEndUrl ?? lineConf.$markerEndUrl;
      }
    }
  } else if (activeRelated) {
    const overrides = lineConf.overrides?.activeRelated;
    strokeColor = overrides?.strokeColor ?? lineConf.strokeColor;
    strokeWidth = overrides?.strokeWidth ?? lineConf.strokeWidth;
    motion = overrides?.motion;
    for (const marker of lineMarkers) {
      if (marker.placement === "start") {
        markerStart =
          lineConf.$activeRelatedMarkerStartUrl ?? lineConf.$markerStartUrl;
      } else {
        markerEnd =
          lineConf.$activeRelatedMarkerEndUrl ?? lineConf.$markerEndUrl;
      }
    }
  } else {
    strokeColor = lineConf.strokeColor;
    strokeWidth = lineConf.strokeWidth;
    for (const marker of lineMarkers) {
      if (marker.placement === "start") {
        markerStart = lineConf.$markerStartUrl;
      } else {
        markerEnd = lineConf.$markerEndUrl;
      }
    }
  }

  let motionPath: string | undefined;
  if (motion?.shape === "dot") {
    const radius = motion.size == null ? strokeWidth * 2 : motion.size / 2;
    motionPath = `M 0,${-radius} A ${radius},${radius} 0,1,1 0,${radius} A ${radius},${radius} 0,1,1 0,${-radius} z`;
  } else if (motion?.shape === "triangle") {
    const radius = motion.size == null ? strokeWidth * 2 : motion.size / 2;
    const offset = radius / Math.sqrt(3);
    motionPath = `M ${-offset},${radius} v ${-radius * 2} L ${offset * 2},0 z`;
  }
  let motionDuration: string | undefined;
  if (pathLength) {
    motionDuration = `${pathLength / (motion?.speed ?? DEFAULT_MOTION_SPEED)}s`;
  }

  const hasMotion = [
    lineConf.overrides?.active?.motion?.shape,
    lineConf.overrides?.activeRelated?.motion?.shape,
  ].some((item) => item === "dot" || item === "triangle");

  const clipPathUrl = clipPathPoints
    ? `url(#${lineClipPathPrefix})`
    : undefined;

  return (
    <>
      {clipPathPoints && (
        <defs>
          <clipPath id={lineClipPathPrefix}>
            <polygon points={clipPathPoints} />
          </clipPath>
        </defs>
      )}
      <g className="line-group" onDoubleClick={onDoubleClick}>
        <path
          // This `path` is made for expanding interaction area of graph lines.
          d={line}
          fill="none"
          stroke="transparent"
          strokeWidth={lineConf.interactStrokeWidth}
          clipPath={clipPathUrl}
        />
        <path
          ref={pathRefCallback}
          className={classNames("line", {
            dashed: lineConf.dashed,
            dotted: lineConf.dotted,
            [`${lineConf.dashed ? "dashed" : lineConf.dotted ? "dotted" : "solid"}-animation`]:
              lineConf.animate.useAnimate,
          })}
          clipPath={clipPathUrl}
          style={
            {
              "--time": `${lineConf.animate.duration ?? DEFAULT_LINE_INTERACT_ANIMATE_DURATION}s`,
              "--solid-length": pathLength,
            } as React.CSSProperties
          }
          d={line}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          markerStart={markerStart}
          markerEnd={markerEnd}
        />
        {!lineConf.overrides?.active && (
          <path
            className="line-active-bg"
            d={line}
            fill="none"
            clipPath={clipPathUrl}
          />
        )}
        {
          // No dur in old browsers will cause animation not working.
          // So always set a dur.
          hasMotion && motionDuration && (
            <path
              className={classNames("motion", { visible: !!motionPath })}
              d={motionPath}
              fill={strokeColor}
            >
              <animateMotion
                dur={motionDuration}
                repeatCount={"indefinite"}
                rotate={"auto"}
                path={line}
              />
            </path>
          )
        }
      </g>
      <LineLabelComponent
        edge={edge}
        position={labelPosition}
        offset={labelOffset}
        label={lineConf.label}
        text={lineConf.text}
        onClick={onLabelClick}
        onRendered={handleLabelRendered}
      />
    </>
  );
}
