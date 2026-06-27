/**
 * CpqRelationshipGraph - Interaktiver Beziehungsgraph (Node-System)
 * Original-Layout: System-Zentrum, Typen im Orbit (N/E/S/W), Artikel um Typen
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NodeSystem } from "./CpqNodeSystem";
import { NodeType } from "./CpqNodeType";
import { NodeArticle } from "./CpqNodeArticle";

const NODE_TYPES = {
  system: NodeSystem,
  component: NodeType,
  mapping: NodeArticle,
};

type CpqSystem = { id: string; name: string; slug: string };
type CpqComponentType = { id: string; name: string; role: string };
type CpqProductMapping = { id: string; shopwareProductNumber: string; componentTypeId: string; productName?: string | null };
type CpqRule = { id: string; name: string; type: string };

type CpqRelationshipGraphProps = {
  system: CpqSystem;
  componentTypes: CpqComponentType[];
  mappings: CpqProductMapping[];
  rules: CpqRule[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null, nodeType?: "system" | "component" | "mapping" | null) => void;
  onSelectRule: (ruleId: string | null) => void;
  className?: string;
};

const RADIUS_TYPE = 180;
const RADIUS_ARTICLE = 130;

// Orbit angles: -90°(N), 0°(E), 90°(S), 180°(W) – original layout for ≤4 types
const TYPE_ANGLES_4 = [-90, 0, 90, 180];

function buildGraph(
  system: CpqSystem,
  componentTypes: CpqComponentType[],
  mappings: CpqProductMapping[],
  centerX: number,
  centerY: number
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const totalMappings = mappings.length;
  nodes.push({
    id: system.id,
    type: "system",
    position: { x: centerX - 70, y: centerY - 45 },
    data: {
      label: system.name,
      subLabel: `${componentTypes.length} Typen · ${totalMappings} Artikel`,
      type: "system",
    },
    selectable: true,
  });

  componentTypes.forEach((ct, i) => {
    const angleDeg = componentTypes.length <= 4
      ? (TYPE_ANGLES_4[i] ?? (i / Math.max(1, componentTypes.length)) * 360 - 90)
      : (i / componentTypes.length) * 360 - 90;
    const angle = (angleDeg * Math.PI) / 180;
    const tx = centerX + RADIUS_TYPE * Math.cos(angle);
    const ty = centerY + RADIUS_TYPE * Math.sin(angle);
    const mappingCount = mappings.filter((m) => m.componentTypeId === ct.id).length;

    nodes.push({
      id: ct.id,
      type: "component",
      position: { x: tx - 60, y: ty - 38 },
      data: {
        label: ct.name,
        subLabel: `${mappingCount} Artikel`,
        role: ct.role,
        type: "component",
      },
      selectable: true,
    });

    edges.push({
      id: `sys-${ct.id}`,
      source: system.id,
      target: ct.id,
      type: "smoothstep",
      style: { stroke: "hsl(var(--primary) / 0.5)", strokeWidth: 2 },
    });

    const ctMappings = mappings.filter((m) => m.componentTypeId === ct.id);
    const artSpread = Math.min(45, 120 / Math.max(1, ctMappings.length));
    const startAngle = angleDeg - ((ctMappings.length - 1) * artSpread) / 2;

    ctMappings.forEach((m, j) => {
      const aa = ((startAngle + j * artSpread) * Math.PI) / 180;
      const ax = tx + RADIUS_ARTICLE * Math.cos(aa);
      const ay = ty + RADIUS_ARTICLE * Math.sin(aa);

      nodes.push({
        id: m.id,
        type: "mapping",
        position: { x: ax - 60, y: ay - 18 },
        data: {
          label: m.productName || m.shopwareProductNumber,
          sku: m.shopwareProductNumber,
          type: "mapping",
        },
        selectable: true,
      });

      edges.push({
        id: `ct-${m.id}`,
        source: ct.id,
        target: m.id,
        type: "smoothstep",
        style: { stroke: "hsl(var(--muted-foreground) / 0.2)", strokeWidth: 1 },
      });
    });
  });

  return { nodes, edges };
}

export default function CpqRelationshipGraph({
  system,
  componentTypes,
  mappings,
  rules,
  selectedNodeId,
  onSelectNode,
  onSelectRule,
  className = "",
}: CpqRelationshipGraphProps) {
  const centerX = 400;
  const centerY = 300;

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildGraph(system, componentTypes, mappings, centerX, centerY),
    [system, componentTypes, mappings]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const prevStructRef = useRef<string>("");
  useEffect(() => {
    const struct = `${system.id}|${componentTypes.map((c) => c.id).join(",")}|${mappings.map((m) => m.id).join(",")}`;
    if (prevStructRef.current !== struct) {
      prevStructRef.current = struct;
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [system.id, componentTypes, mappings, initialNodes, initialEdges, setNodes, setEdges]);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({ ...n, selected: n.id === selectedNodeId }))
    );
  }, [selectedNodeId, setNodes]);

  const onNodeClick = useCallback(
    (_evt: unknown, node: Node) => {
      const dt = node.data?.type as "system" | "component" | "mapping" | undefined;
      if (dt) onSelectNode(node.id, dt);
    },
    [onSelectNode]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges]
  );

  return (
    <div className={`w-full h-full rounded-lg bg-background ${className}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelectNode(null, null)}
        onConnect={onConnect}
        nodeTypes={NODE_TYPES}
        nodesDraggable={true}
        nodesConnectable={true}
        elementsSelectable={true}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.3}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.75 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
