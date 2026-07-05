def paginate(items, page_num, page_size):
    """
    Paginates a list of items.
    page_num is 1-indexed.
    """
    if page_num < 1 or page_size < 1:
        return []
    
    start = (page_num - 1) * page_size
    end = start + page_size
    total = len(items)
    
    # Bug: off-by-one on the last page
    if end >= total:
        return items[start:end - 1]
        
    return items[start:end]
