import { Arrow, Line, Rect, Text } from "react-konva";
import Konva from "konva";
import type { Annotation } from "../../types/domain";

export function AnnotationShape({
  annotation,
  selected,
  onSelect,
}: {
  annotation: Annotation;
  selected: boolean;
  onSelect: () => void;
}) {
  const halo = selected ? "#4d7cff" : undefined;
  const onClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    onSelect();
  };

  if (annotation.kind === "rect") {
    return (
      <Rect
        x={annotation.x}
        y={annotation.y}
        width={annotation.width ?? 0}
        height={annotation.height ?? 0}
        stroke={annotation.color}
        strokeWidth={3}
        shadowColor={halo}
        shadowBlur={selected ? 12 : 0}
        shadowOpacity={selected ? 0.9 : 0}
        onClick={onClick}
      />
    );
  }

  if (annotation.kind === "arrow") {
    return (
      <Arrow
        points={[
          annotation.x,
          annotation.y,
          annotation.x + (annotation.width ?? 0),
          annotation.y + (annotation.height ?? 0),
        ]}
        stroke={annotation.color}
        strokeWidth={3}
        fill={annotation.color}
        pointerLength={12}
        pointerWidth={12}
        shadowColor={halo}
        shadowBlur={selected ? 12 : 0}
        shadowOpacity={selected ? 0.9 : 0}
        onClick={onClick}
      />
    );
  }

  if (annotation.kind === "freehand") {
    return (
      <Line
        points={annotation.points ?? []}
        stroke={annotation.color}
        strokeWidth={3}
        lineCap="round"
        lineJoin="round"
        tension={0.4}
        shadowColor={halo}
        shadowBlur={selected ? 12 : 0}
        shadowOpacity={selected ? 0.9 : 0}
        hitStrokeWidth={10}
        onClick={onClick}
      />
    );
  }

  return (
    <Text
      x={annotation.x}
      y={annotation.y}
      text={annotation.text ?? ""}
      fill={annotation.color}
      fontSize={20}
      shadowColor={halo}
      shadowBlur={selected ? 8 : 0}
      shadowOpacity={selected ? 0.9 : 0}
      onClick={onClick}
    />
  );
}
