import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { Note, D3Node, D3Link } from '../types';

interface NetworkGraphProps {
  notes: Note[];
  onNodeClick: (nodeId: string) => void;
  selectedNoteId: string | null;
}

const NetworkGraph: React.FC<NetworkGraphProps> = ({ notes, onNodeClick, selectedNoteId }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { nodes, links } = useMemo(() => {
    const newNodes: D3Node[] = notes.map(note => ({ id: note.id, title: note.title }));
    const newLinks: D3Link[] = [];
    const titleToIdMap = new Map(notes.map(note => [note.title.trim().toLowerCase(), note.id]));

    notes.forEach(note => {
      const linkMatches = note.content.match(/\[\[(.*?)\]\]/g) || [];
      // FIX: Explicitly type `match` as string to prevent it from being inferred as `never`.
      linkMatches.forEach((match: string) => {
        const targetTitle = match.substring(2, match.length - 2).trim().toLowerCase();
        const targetId = titleToIdMap.get(targetTitle);
        if (targetId && targetId !== note.id) {
          newLinks.push({ source: note.id, target: targetId });
        }
      });
    });

    return { nodes: newNodes, links: newLinks };
  }, [notes]);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); 

    const width = svg.node()!.getBoundingClientRect().width;
    const height = svg.node()!.getBoundingClientRect().height;

    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force("link", d3.forceLink<D3Node, D3Link>(links).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX(width / 2).strength(0.05))
      .force("y", d3.forceY(height / 2).strength(0.05));

    const g = svg.append("g");

    const link = g.append("g")
      .attr("stroke", "#6b7280")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 1.5);

    const node = g.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(drag(simulation) as any)
      .on("click", (event, d) => {
        onNodeClick(d.id);
        event.stopPropagation();
      });

    node.append("circle")
      .attr("r", 8)
      .attr("stroke", "#4b5563")
      .attr("stroke-width", 1.5);

    node.append("text")
      .attr("x", 12)
      .attr("y", "0.31em")
      .text(d => d.title)
      .attr("fill", "#d1d5db")
      .attr("font-size", "12px")
      .attr("paint-order", "stroke")
      .attr("stroke", "#111827")
      .attr("stroke-width", "3px")
      .attr("stroke-linecap", "butt")
      .attr("stroke-linejoin", "miter");

    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as D3Node).x!)
        .attr("y1", d => (d.source as D3Node).y!)
        .attr("x2", d => (d.target as D3Node).x!)
        .attr("y2", d => (d.target as D3Node).y!);

      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    return () => {
        simulation.stop();
    };

  }, [nodes, links, onNodeClick]);
  
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("circle")
        .data(nodes, (d: any) => d.id)
        .transition().duration(200)
        .attr("fill", d => d.id === selectedNoteId ? "#38bdf8" : "#374151")
        .attr("r", d => d.id === selectedNoteId ? 12 : 8);

    svg.selectAll("text")
        .data(nodes, (d: any) => d.id)
        .transition().duration(200)
        .attr("font-weight", d => d.id === selectedNoteId ? "bold" : "normal")
        .attr("fill", d => d.id === selectedNoteId ? "#7dd3fc" : "#d1d5db");

  }, [selectedNoteId, nodes]);

  const drag = (simulation: d3.Simulation<D3Node, undefined>) => {
    function dragstarted(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    
    function dragged(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      d.fx = event.x;
      d.fy = event.y;
    }
    
    function dragended(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    
    return d3.drag<SVGGElement, D3Node>()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended);
  }

  return (
    <div className="w-full h-full bg-gray-900 rounded-lg">
      <svg ref={svgRef} className="w-full h-full"></svg>
    </div>
  );
};

export default NetworkGraph;