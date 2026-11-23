import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChakraProvider } from '@chakra-ui/react'
import PermissionList from './PermissionList'
import { testResponse } from '../../api/common'

const permissions = [
  { name: 'read', needed_for: 'previews', allowed: true, detail: '', required: true },
  { name: 'delete', needed_for: 'deleting files', allowed: false, detail: 'AccessDenied', required: true },
  { name: 'import rasters', needed_for: 'raster imports', allowed: false, detail: '', required: false },
]

describe('PermissionList', () => {
  it('says what each permission is for, and what fails without it', () => {
    render(
      <ChakraProvider>
        <PermissionList permissions={permissions} />
      </ChakraProvider>
    )
    expect(screen.getByText(/— for previews/)).toBeInTheDocument()
    expect(screen.getByText(/not allowed: deleting files won't work$/)).toBeInTheDocument()
    expect(screen.getByText(/raster imports won't work \(optional\)/)).toBeInTheDocument()
  })

  it('shows nothing without permissions', () => {
    const { container } = render(<PermissionList permissions={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('testResponse', () => {
  const json = (status: number, body: object) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it("reads a failed test's answer, with the permissions it lacks", async () => {
    const body = { status: 'error', message: 'This key may not: delete.', permissions }
    await expect(testResponse(json(400, body))).resolves.toEqual(body)
  })

  it('still throws for a request it refused', async () => {
    await expect(testResponse(json(400, { error: 'Bucket is required' }))).rejects.toThrow(
      'Bucket is required'
    )
  })
})
