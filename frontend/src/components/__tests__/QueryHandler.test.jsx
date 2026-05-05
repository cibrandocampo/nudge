import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import QueryHandler from '../QueryHandler'

describe('QueryHandler', () => {
  it('renders a Spinner when isLoading', () => {
    render(
      <QueryHandler isLoading>
        <div>content</div>
      </QueryHandler>,
    )
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('renders the notFoundKey message when isError with status 404', () => {
    render(
      <QueryHandler isError error={{ status: 404 }} notFoundKey="stockDetail.notFound" errorKey="common.error">
        <div>content</div>
      </QueryHandler>,
    )
    expect(screen.getByText('Stock not found.')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('renders the errorKey message when isError without 404', () => {
    render(
      <QueryHandler isError error={{ status: 500 }} notFoundKey="stockDetail.notFound">
        <div>content</div>
      </QueryHandler>,
    )
    expect(screen.getByText('Could not load data. Try refreshing the page.')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('renders the notFoundKey message when notFound is true (no error)', () => {
    render(
      <QueryHandler notFound notFoundKey="stockDetail.notFound">
        <div>content</div>
      </QueryHandler>,
    )
    expect(screen.getByText('Stock not found.')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('renders children when not loading, not error, and not notFound', () => {
    render(
      <QueryHandler>
        <div>content</div>
      </QueryHandler>,
    )
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
  })

  it('falls through to errorKey when isError without notFoundKey', () => {
    render(
      <QueryHandler isError error={{ status: 404 }}>
        <div>content</div>
      </QueryHandler>,
    )
    // no notFoundKey provided → 404 falls through to errorKey
    expect(screen.getByText('Could not load data. Try refreshing the page.')).toBeInTheDocument()
  })

  // ── Degraded mode (T155): render persisted data even when isError ────────
  it('renders children when isError but data is present (degraded mode)', () => {
    render(
      <QueryHandler isError error={{ status: 500 }} data={{ id: 1, name: 'foo' }}>
        <div>content</div>
      </QueryHandler>,
    )
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByText('Could not load data. Try refreshing the page.')).not.toBeInTheDocument()
  })

  it('renders the errorKey message when isError and data is undefined', () => {
    render(
      <QueryHandler isError error={{ status: 500 }} data={undefined}>
        <div>content</div>
      </QueryHandler>,
    )
    expect(screen.getByText('Could not load data. Try refreshing the page.')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('404 wins over data presence (resource is definitively gone)', () => {
    render(
      <QueryHandler
        isError
        error={{ status: 404 }}
        data={{ id: 1, name: 'foo' }}
        notFoundKey="stockDetail.notFound"
      >
        <div>content</div>
      </QueryHandler>,
    )
    expect(screen.getByText('Stock not found.')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('treats an empty array data as valid (renders children in degraded mode)', () => {
    render(
      <QueryHandler isError error={{ status: 500 }} data={[]}>
        <div>content</div>
      </QueryHandler>,
    )
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
