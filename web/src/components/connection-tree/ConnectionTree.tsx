import { useEffect } from "react";
import { Box } from '@chakra-ui/react'
import { CloudBenchRootNode } from './nodes'
import { useConnectionStore } from "../../stores/connectionStore.ts";

export default function ConnectionTree() {
  const fetchConnections = useConnectionStore((state) => state.fetchConnections)

  useEffect(() => {
    fetchConnections()
  }, [fetchConnections])

  return (
    <Box>
      {/* CloudBench Root Node */}
      <CloudBenchRootNode/>
    </Box>
  )
}