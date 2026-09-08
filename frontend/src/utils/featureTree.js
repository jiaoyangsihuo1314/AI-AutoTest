export function flattenFeatureTree(nodes = []) {
  return nodes.flatMap((node) => [node, ...flattenFeatureTree(node.children || [])]);
}
