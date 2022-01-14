import type {ParsedCodeblock} from "../interfaces";
import type BCPlugin from "../main";
import {
    DataStoreEvents,
    getPlugin,
    ICoreDataStore,
    IJuggl,
    IJugglPlugin, IJugglSettings, IJugglStores, nodeDangling,
    nodeFromFile,
    VizId
} from 'juggl-api';
import {JUGGL_CB_DEFAULTS} from "../constants";
import {Component, EventRef, Events, MetadataCache, TFile} from "obsidian";
import type {MultiGraph} from "graphology";
import type {EdgeDefinition, NodeSingular} from "cytoscape";

const STORE_ID = "core";

function indentToDepth(indent: string) {
    return indent.length / 2 + 1;
}

function meetsConditions(indent: string, node: string, froms: string[], min: number, max: number) {
    const depth = indentToDepth(indent);
    return (
        depth >= min &&
        depth <= max &&
        (froms === undefined || froms.includes(node))
    );
}

class BCStoreEvents extends Events implements DataStoreEvents {

}

class BCStore extends Component implements ICoreDataStore {

    graph: MultiGraph;
    cache: MetadataCache;
    plugin: IJugglPlugin;
    constructor(graph: MultiGraph, metadata: MetadataCache, plugin: IJugglPlugin) {
        super();
        this.graph = graph;
        this.cache = metadata;
        this.plugin = plugin;
    }

    asString(node: NodeSingular): string {
        const id = VizId.fromNode(node);
        return id.id.slice(0, -3);
    }

    getFile(nodeId: VizId): TFile {
        return this.cache.getFirstLinkpathDest(nodeId.id, '');
    }

    async connectNodes(allNodes: cytoscape.NodeCollection, newNodes: cytoscape.NodeCollection, graph: IJuggl): Promise<cytoscape.EdgeDefinition[]> {
        const edges: EdgeDefinition[] = [];
        const nodesListS = new Set(allNodes
            .map((node) => this.asString(node))
            .filter((s) => s));
        newNodes.forEach((node) => {
            console.log({node})
            this.graph.forEachOutEdge(this.asString(node), (key, attr, source, target) => {
                if (nodesListS.has(target)) {
                    edges.push({
                        data: {
                            id: `BC:${source}->${target}`,
                            source: VizId.toId(source, STORE_ID) + ".md",
                            target: VizId.toId(target, STORE_ID) + ".md",
                            type: attr.field,
                            dir: attr.dir,
                        },
                        classes: `type-${attr.field} dir-${attr.dir} breadcrumbs$`
                    });
                }
            });
        });
        return Promise.resolve(edges);
    }

    getEvents(): DataStoreEvents {
        return new BCStoreEvents();
    }

    async getNeighbourhood(nodeId: VizId[]): Promise<cytoscape.NodeDefinition[]> {
        const newNodes: cytoscape.NodeDefinition[] = [];
        for (const id of nodeId)  {
            const source = id.id.slice(0, -3);
            await this.graph.forEachNeighbor(source, async (neighbor) => {
                const neighborId = new VizId(neighbor + ".md", STORE_ID);
                newNodes.push(await this.get(neighborId));
            })
        }
        console.log({newNodes})
        return newNodes;
    }

    refreshNode(view: IJuggl, id: VizId): void | Promise<void> {
        return;
    }

    storeId(): string {
        return STORE_ID;
    }



    get(nodeId: VizId): Promise<cytoscape.NodeDefinition> {
        const file = this.getFile(nodeId);
        if (file === null) {
            const dangling = nodeDangling(nodeId.id);
            console.log({dangling});
            return Promise.resolve(nodeDangling(nodeId.id));
        }
        const cache = this.cache.getFileCache(file);
        if (cache === null) {
            console.log('returning empty cache', nodeId);
            return Promise.resolve(nodeDangling(nodeId.id));
        }
        return nodeFromFile(file, this.plugin, nodeId.toId());
    }

}

function createJuggl(plugin: BCPlugin, target: HTMLElement, initialNodes: string[], args: IJugglSettings) {
    try {
        const jugglPlugin = getPlugin(plugin.app);
        if (!jugglPlugin) {
            // TODO: Error handling
            return;
        }
        for (let key in JUGGL_CB_DEFAULTS) {
            if (key in args && args[key] === undefined) {
                args[key] = JUGGL_CB_DEFAULTS[key];
            }
        }


        const bcStore = new BCStore(plugin.mainG, plugin.app.metadataCache, jugglPlugin);
        const stores: IJugglStores = {
            coreStore: bcStore,
            dataStores: [bcStore]
        }

        console.log({args}, {initialNodes});
        const juggl = jugglPlugin.createJuggl(target, args, stores, initialNodes)
        plugin.addChild(juggl);
        juggl.load();
        console.log({juggl});
    }
    catch (error) {
        console.log({error});
    }
}

export function createJugglTrail(plugin: BCPlugin,
                                 target: HTMLElement,
                                 paths: string[][],
                                 source: string,
                                 args: IJugglSettings) {
    let nodes = Array.from(
        new Set(
            paths.reduce((prev, curr) => prev.concat(curr), [])
        ));
    nodes.push(source)
    nodes = nodes.map(s => s + ".md");
    createJuggl(plugin, target, nodes, args);
}

export function createdJugglCB(plugin: BCPlugin,
                               target: HTMLElement,
                               args: ParsedCodeblock,
                               lines: [string, string][],
                               froms: string[],
                               source: string,
                               min: number,
                               max: number) {
    const nodes = lines
        .filter(([indent, node]) => meetsConditions(indent, node, froms, min, max))
        .map(([_, node]) => node + ".md");
    if (min <= 0) {
        nodes.push(source + ".md");
    }
    console.log({lines, nodes})
    createJuggl(plugin, target, nodes, args);

}