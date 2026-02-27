import { create } from 'zustand'
import type { FilterType, FilterParams } from '@app-types/filter.ts'
import { defaultParamsForFilter } from '@app-types/filter.ts'

interface FilterStore {
  activeFilter: FilterType | null
  params: FilterParams | null

  openFilter: (filterType: FilterType) => void
  updateParams: (params: FilterParams) => void
  closeFilter: () => void
}

export const useFilterStore = create<FilterStore>((set) => ({
  activeFilter: null,
  params: null,

  openFilter: (filterType) =>
    set({
      activeFilter: filterType,
      params: defaultParamsForFilter(filterType),
    }),

  updateParams: (params) => set({ params }),

  closeFilter: () => set({ activeFilter: null, params: null }),
}))
