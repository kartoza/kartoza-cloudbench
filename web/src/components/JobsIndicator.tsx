import { useEffect, useRef } from 'react'
import {
  Badge,
  Box,
  Button,
  HStack,
  Icon,
  IconButton,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Progress,
  Spinner,
  Text,
  Tooltip,
  VStack,
  useToast,
} from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FiActivity, FiAlertCircle, FiCheckCircle, FiCircle, FiLayers, FiRefreshCw, FiSquare, FiXCircle } from 'react-icons/fi'
import * as api from '../api'
import { BULK_BATCHES_QUERY_KEY, cancelBulk, isActiveBatch, listBulk, type BulkBatch } from '../api/bulk'
import { useUIStore } from '../stores/uiStore'
import { batchProgress, batchSummary } from '../utils/bulkBatch'
import type { ConversionJob } from '../types'
import { isActiveJob, isActiveStatus, isCancellableJob, jobKindLabel, layerConversionStatuses } from '../utils/conversionJobs'

// The header's list of conversions: they run on the server, so progress can
// be followed from anywhere - after the upload dialog that started one is
// closed, or the page refreshed.
export const CONVERSION_JOBS_QUERY_KEY = ['conversionJobs']
const ACTIVE_POLL_MS = 3000
const IDLE_POLL_MS = 30000

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

function JobRow({ job }: { job: ConversionJob }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const active = isActiveJob(job)
  const layers = active ? layerConversionStatuses(job) : null
  const cancel = async () => {
    try {
      await api.cancelConversionJob(job.id)
    } catch (err) {
      toast({ title: "Couldn't stop the conversion", description: (err as Error).message, status: 'error', duration: 5000 })
    }
    queryClient.invalidateQueries({ queryKey: CONVERSION_JOBS_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: ['conversionJob', job.id] })
  }
  return (
    <Box py={2.5} borderBottom="1px solid" borderColor="gray.100" _last={{ borderBottom: 'none' }}>
      <HStack justify="space-between" align="start" spacing={2}>
        <Box minW={0}>
          <Text fontSize="sm" fontWeight="600" noOfLines={1} mb="6px">
            {job.sourcePath}
          </Text>
          <Text fontSize="xs" color="gray.500">
            {jobKindLabel(job)} · {relativeTime(job.startedAt)}
          </Text>
        </Box>
        {job.status === 'completed' && <Icon as={job.error ? FiAlertCircle : FiCheckCircle} color={job.error ? 'orange.400' : 'green.500'} mt={1} />}
        {job.status === 'failed' && <Icon as={FiAlertCircle} color="red.500" mt={1} />}
        {job.status === 'cancelled' && <Icon as={FiXCircle} color="gray.400" mt={1} />}
        {active && (
          <HStack spacing={1} mt={0.5}>
            {isCancellableJob(job) && (
              <Tooltip label="Stop conversion">
                <IconButton
                  aria-label="Stop conversion"
                  icon={<FiSquare />}
                  size="xs"
                  variant="ghost"
                  colorScheme="red"
                  onClick={cancel}
                />
              </Tooltip>
            )}
            <Spinner size="xs" color={job.status === 'cancelling' ? 'gray.400' : 'blue.500'} />
          </HStack>
        )}
      </HStack>
      {active && (
        <Progress value={job.progress} size="xs" colorScheme="blue" borderRadius="sm" mt={2} hasStripe isAnimated />
      )}
      <Text fontSize="xs" color={job.status === 'failed' ? 'red.600' : 'gray.600'} mt={1} noOfLines={2}>
        {job.status === 'failed' ? job.error || job.message : job.message}
      </Text>
      {job.status === 'completed' && job.error && (
        <Text fontSize="xs" color="orange.600" noOfLines={2}>
          Skipped: {job.error}
        </Text>
      )}
      {layers && (
        <VStack align="stretch" spacing={0.5} mt={1.5}>
          {layers.map((layer) => (
            <HStack key={layer.name} spacing={1.5}>
              {layer.status === 'done' && <Icon as={FiCheckCircle} color="green.500" boxSize={3} />}
              {layer.status === 'active' && <Icon as={FiRefreshCw} className="spin" color="blue.500" boxSize={3} />}
              {layer.status === 'pending' && <Icon as={FiCircle} color="gray.300" boxSize={3} />}
              <Text fontSize="xs" color={layer.status === 'pending' ? 'gray.400' : 'gray.700'}>
                {layer.name}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
      {job.server && (
        <Text fontSize="xs" color="gray.500" mt={1} noOfLines={1}>
          {job.server.instanceId.slice(0, 8)} · {job.server.label}
          {' · '}{job.server.jobs} job{job.server.jobs === 1 ? '' : 's'} - {job.server.status}
        </Text>
      )}
    </Box>
  )
}

// A bulk upload is one entry here, however many layers it converts; opening
// it shows the layers in the Bulk upload dialog.
function BatchRow({ batch }: { batch: BulkBatch }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const openDialog = useUIStore((state) => state.openDialog)
  const active = isActiveBatch(batch)
  const cancel = async () => {
    try {
      await cancelBulk(batch.id)
    } catch (err) {
      toast({ title: "Couldn't stop the bulk upload", description: (err as Error).message, status: 'error', duration: 5000 })
    }
    queryClient.invalidateQueries({ queryKey: BULK_BATCHES_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: ['bulkBatch', batch.id] })
  }
  return (
    <Box py={2.5} borderBottom="1px solid" borderColor="gray.100" _last={{ borderBottom: 'none' }}>
      <HStack justify="space-between" align="start" spacing={2}>
        <Box minW={0}>
          <HStack spacing={1.5} mb="6px">
            <Icon as={FiLayers} color="orange.400" boxSize={3.5} />
            <Text fontSize="sm" fontWeight="600" noOfLines={1}>
              Bulk upload: {batch.prefix}
            </Text>
          </HStack>
          <Text fontSize="xs" color="gray.500">
            {batch.jobs.length} layers · {batch.concurrency} at a time · {relativeTime(batch.createdAt)}
          </Text>
        </Box>
        <HStack spacing={1} mt={0.5}>
          {active && (
            <Tooltip label="Cancel the batch">
              <IconButton aria-label="Cancel bulk upload" icon={<FiSquare />} size="xs" variant="ghost" colorScheme="red" onClick={cancel} />
            </Tooltip>
          )}
          {active && <Spinner size="xs" color="blue.500" />}
          {batch.status === 'completed' && <Icon as={FiCheckCircle} color="green.500" />}
          {(batch.status === 'failed' || batch.status === 'partial') && <Icon as={FiAlertCircle} color={batch.status === 'failed' ? 'red.500' : 'orange.400'} />}
          {batch.status === 'cancelled' && <Icon as={FiXCircle} color="gray.400" />}
        </HStack>
      </HStack>
      {active && <Progress value={batchProgress(batch)} size="xs" colorScheme="blue" borderRadius="sm" mt={2} hasStripe isAnimated />}
      <HStack justify="space-between" mt={1}>
        <Text fontSize="xs" color="gray.600">{batchSummary(batch)}</Text>
        <Button
          size="xs"
          variant="link"
          colorScheme="orange"
          onClick={() => openDialog('s3bulk', { mode: 'view', data: { connectionId: batch.connectionId, batchId: batch.id } })}
        >
          Open
        </Button>
      </HStack>
    </Box>
  )
}

export default function JobsIndicator() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: batches = [], isSuccess: batchesLoaded } = useQuery({
    queryKey: BULK_BATCHES_QUERY_KEY,
    queryFn: listBulk,
    refetchInterval: (query) => ((query.state.data ?? []).some(isActiveBatch) ? ACTIVE_POLL_MS / 3 : IDLE_POLL_MS),
  })
  const { data: jobs = [], isLoading, isError } = useQuery({
    queryKey: CONVERSION_JOBS_QUERY_KEY,
    queryFn: api.getConversionJobs,
    refetchInterval: (query) =>
      (query.state.data ?? []).some(isActiveJob) ? ACTIVE_POLL_MS : IDLE_POLL_MS,
  })
  const activeCount = jobs.filter(isActiveJob).length + batches.filter(isActiveBatch).length

  // Announce a job finishing - one seen running in this session, so a
  // refresh doesn't replay notifications for jobs that finished earlier.
  const lastStatus = useRef<Map<string, ConversionJob['status']> | null>(null)
  useEffect(() => {
    if (isLoading || isError) return
    const previous = lastStatus.current
    const current = new Map(jobs.map((job) => [job.id, job.status]))
    if (previous) {
      for (const job of jobs) {
        const before = previous.get(job.id)
        if (!before || !isActiveStatus(before) || isActiveJob(job)) continue
        const finished = job.status === 'completed'
        const cancelled = job.status === 'cancelled'
        toast({
          title: `${job.sourcePath}: ${
            finished ? 'conversion finished' : cancelled ? 'conversion cancelled' : 'conversion failed'
          }`,
          description: finished || cancelled ? job.message : job.error || job.message,
          status: finished ? (job.error ? 'warning' : 'success') : cancelled ? 'info' : 'error',
          duration: 6000,
          isClosable: true,
        })
        // Newly published layers: refresh the S3 browser listings.
        if (finished) queryClient.invalidateQueries({ queryKey: ['s3objects'] })
      }
    }
    lastStatus.current = current
  }, [jobs, isLoading, isError, toast, queryClient])

  // Likewise a bulk upload finishing: one seen running in this session.
  const lastBatchStatus = useRef<Map<string, BulkBatch['status']> | null>(null)
  useEffect(() => {
    if (!batchesLoaded) return
    const previous = lastBatchStatus.current
    if (previous) {
      for (const batch of batches) {
        const before = previous.get(batch.id)
        if (!before || !(before === 'running' || before === 'cancelling') || isActiveBatch(batch)) continue
        toast({
          title: `Bulk upload of ${batch.prefix}: ${
            batch.status === 'completed' ? 'finished' : batch.status === 'cancelled' ? 'cancelled' : batch.status === 'partial' ? 'finished with failures' : 'failed'
          }`,
          description: batchSummary(batch),
          status:
            batch.status === 'completed' ? 'success' : batch.status === 'cancelled' ? 'info' : batch.status === 'partial' ? 'warning' : 'error',
          duration: 8000,
          isClosable: true,
        })
        // Newly published layers: refresh the S3 browser listings.
        if (batch.status === 'completed' || batch.status === 'partial') queryClient.invalidateQueries({ queryKey: ['s3objects'] })
      }
    }
    lastBatchStatus.current = new Map(batches.map((batch) => [batch.id, batch.status]))
  }, [batches, batchesLoaded, toast, queryClient])

  return (
    <Popover placement="bottom-end" isLazy>
      <Tooltip label={activeCount ? `${activeCount} conversion${activeCount === 1 ? '' : 's'} running` : 'Jobs'} placement="bottom">
        <Box position="relative" display="inline-flex">
          <PopoverTrigger>
            <IconButton
              aria-label="Jobs"
              icon={activeCount ? <Spinner size="sm" speed="1.2s" /> : <FiActivity size={18} />}
              variant="ghost"
              color={activeCount ? 'blue.500' : 'gray.600'}
              _hover={{ bg: 'gray.100', color: 'kartoza.500' }}
              size="sm"
            />
          </PopoverTrigger>
          {activeCount > 0 && (
            <Badge
              position="absolute"
              top="-2px"
              right="-2px"
              colorScheme="blue"
              variant="solid"
              borderRadius="full"
              fontSize="10px"
              px={1.5}
              pointerEvents="none"
            >
              {activeCount}
            </Badge>
          )}
        </Box>
      </Tooltip>
      <PopoverContent w="360px">
        <PopoverArrow />
        <PopoverHeader fontWeight="600" fontSize="sm">
          Conversions
          <Text as="span" fontWeight="normal" color="gray.500" fontSize="xs" ml={2}>
            running and last 24 h
          </Text>
        </PopoverHeader>
        <PopoverBody maxH="420px" overflowY="auto" py={1}>
          {isLoading && (
            <HStack py={4} justify="center">
              <Spinner size="sm" />
            </HStack>
          )}
          {isError && (
            <VStack py={4} spacing={2}>
              <Text fontSize="sm" color="red.500">Couldn&apos;t load jobs.</Text>
              <Button size="xs" onClick={() => queryClient.invalidateQueries({ queryKey: CONVERSION_JOBS_QUERY_KEY })}>
                Retry
              </Button>
            </VStack>
          )}
          {batches.map((batch) => (
            <BatchRow key={batch.id} batch={batch} />
          ))}
          {!isLoading && !isError && jobs.length === 0 && batches.length === 0 && (
            <Text fontSize="sm" color="gray.500" py={4} textAlign="center">
              No conversions in the last 24 hours.
            </Text>
          )}
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}
