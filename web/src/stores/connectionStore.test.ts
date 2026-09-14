/**
 * Tests for connection store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useConnectionStore } from './connectionStore'

// Create a mock fetch function
const mockFetch = vi.fn()

describe('connectionStore', () => {
  beforeEach(() => {
    // Stub global fetch with our mock
    vi.stubGlobal('fetch', mockFetch)

    // Reset store state
    useConnectionStore.setState({
      connections: [],
      activeConnectionId: null,
      isLoading: false,
      error: null,
    })
    mockFetch.mockReset()
  })

  describe('fetchConnections', () => {
    it('should fetch connections successfully', async () => {
      const mockConnections = [
        {
          id: 'conn-1',
          name: 'Test GeoServer',
          url: 'http://localhost:8080/geoserver',
          username: 'admin',
          is_active: false,
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConnections),
      })

      await useConnectionStore.getState().fetchConnections()

      expect(useConnectionStore.getState().connections).toEqual(mockConnections)
      expect(useConnectionStore.getState().isLoading).toBe(false)
    })

    it('should handle fetch error', async () => {
      mockFetch.mockRejectedValueOnce(
        new Error('Network error')
      )

      await useConnectionStore.getState().fetchConnections()

      expect(useConnectionStore.getState().error).toBeTruthy()
    })
  })

  describe('addConnection', () => {
    it('should add a new connection', async () => {
      const newConnection = {
        name: 'New GeoServer',
        url: 'http://localhost:8081/geoserver',
        username: 'admin',
        password: 'pass',
      }

      const createdConnection = {
        id: 'new-conn-id',
        ...newConnection,
        is_active: false,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createdConnection),
      })

      await useConnectionStore.getState().addConnection(newConnection)

      expect(useConnectionStore.getState().connections).toContainEqual(
        expect.objectContaining({ id: 'new-conn-id' })
      )
    })
  })

  describe('removeConnection', () => {
    it('should remove a connection', async () => {
      // Set initial state with a connection
      useConnectionStore.setState({
        connections: [
          {
            id: 'conn-to-remove',
            name: 'Test',
            url: 'http://test',
            username: 'admin',
            password: '',
            isActive: false,
          },
        ],
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(undefined),
      })

      await useConnectionStore.getState().removeConnection('conn-to-remove')

      expect(useConnectionStore.getState().connections).toEqual([])
    })
  })

  describe('setActiveConnection', () => {
    it('should set active connection id', () => {
      const connection = {
        id: 'conn-1',
        name: 'Test',
        url: 'http://test',
        username: 'admin',
        password: '',
        isActive: false,
      }

      useConnectionStore.setState({
        connections: [connection],
      })

      useConnectionStore.getState().setActiveConnection('conn-1')

      expect(useConnectionStore.getState().activeConnectionId).toEqual('conn-1')
    })

    it('should clear active connection id', () => {
      useConnectionStore.setState({
        activeConnectionId: 'conn-1',
      })

      useConnectionStore.getState().setActiveConnection(null)

      expect(useConnectionStore.getState().activeConnectionId).toBeNull()
    })
  })
})
