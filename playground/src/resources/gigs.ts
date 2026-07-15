import { defineResource } from '@mattthehat/astro-cms'

export const gigs = defineResource({
  table: 'gigs',
  idColumn: 'id',
  basePath: '/',
  singular: 'gig',
  defaultSort: { column: 'date', dir: 'asc' },
  perPage: 5,
  fields: {
    artist: {
      label: 'Artist',
      rules: { required: true },
      list: true,
      search: true,
      sort: true,
    },
    venue: {
      label: 'Venue',
      rules: { required: true },
      list: true,
      search: true,
    },
    city: {
      label: 'City',
      type: 'select',
      options: [
        { value: 'Bristol', label: 'Bristol' },
        { value: 'Edinburgh', label: 'Edinburgh' },
        { value: 'Glasgow', label: 'Glasgow' },
        { value: 'Liverpool', label: 'Liverpool' },
        { value: 'London', label: 'London' },
        { value: 'Manchester', label: 'Manchester' },
      ],
      rules: { required: true },
      list: { pill: 'primary' },
      sort: true,
    },
    date: {
      label: 'Date',
      type: 'datetime-local',
      rules: { required: true },
      list: { format: 'datetime' },
      sort: true,
    },
    price: {
      label: 'Ticket price',
      type: 'number',
      step: '0.01',
      min: 0,
      list: { format: 'currency' },
      sort: true,
    },
    sold_out: {
      label: 'Sold out',
      type: 'switch',
      list: { format: 'bool' },
    },
    notes: {
      label: 'Notes',
      type: 'textarea',
      rows: 3,
    },
  },
  filters: [
    {
      type: 'select',
      key: 'city',
      label: 'City',
      column: 'city',
      options: [
        { value: 'Bristol', label: 'Bristol' },
        { value: 'Edinburgh', label: 'Edinburgh' },
        { value: 'Glasgow', label: 'Glasgow' },
        { value: 'Liverpool', label: 'Liverpool' },
        { value: 'London', label: 'London' },
        { value: 'Manchester', label: 'Manchester' },
      ],
    },
    { type: 'dateRange', key: 'date', label: 'Date', column: 'date' },
    { type: 'bool', key: 'sold_out', label: 'Sold out only', column: 'sold_out' },
    { type: 'nonempty', key: 'notes', label: 'Notes', column: 'notes', setLabel: 'Has notes', unsetLabel: 'No notes' },
  ],
})
