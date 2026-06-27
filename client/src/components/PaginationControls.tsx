import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { useTranslation } from "react-i18next";

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  itemsPerPage: string;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (value: string) => void;
  showItemsPerPage?: boolean;
  totalItems?: number;
}

export default function PaginationControls({
  currentPage,
  totalPages,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  showItemsPerPage = true,
  totalItems,
}: PaginationControlsProps) {
  const { t } = useTranslation();

  const generatePageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('ellipsis');
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('ellipsis');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  const pageNumbers = generatePageNumbers();

  if (totalPages <= 1 && !showItemsPerPage) {
    return null;
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      {showItemsPerPage && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('common.show')}</span>
          <Select value={itemsPerPage} onValueChange={onItemsPerPageChange}>
            <SelectTrigger className="w-20" data-testid="select-items-per-page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {t('common.itemsPerPage')}
          </span>
          {totalItems !== undefined && (
            <span className="text-sm text-muted-foreground ml-2">
              ({totalItems} {t('common.total')})
            </span>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onPageChange(1)}
                disabled={currentPage === 1}
                aria-label={t('common.first')}
                data-testid="button-first-page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
            </PaginationItem>

            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label={t('common.previous')}
                data-testid="button-previous-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </PaginationItem>

            {pageNumbers.map((page, index) =>
              page === 'ellipsis' ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={page}>
                  <PaginationLink
                    onClick={(e) => {
                      e.preventDefault();
                      onPageChange(page);
                    }}
                    isActive={currentPage === page}
                    className="cursor-pointer"
                    data-testid={`button-page-${page}`}
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              )
            )}

            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                aria-label={t('common.next')}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </PaginationItem>

            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onPageChange(totalPages)}
                disabled={currentPage === totalPages}
                aria-label={t('common.last')}
                data-testid="button-last-page"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
