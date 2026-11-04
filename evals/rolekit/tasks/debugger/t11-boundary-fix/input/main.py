import sys
from lib.pager import paginate

if __name__ == '__main__':
    # Demonstration of the reported bug
    items = ['a', 'b', 'c', 'd']
    page_size = 2
    page_num = 2
    result = paginate(items, page_num, page_size)
    print(f"Items: {items}")
    print(f"Page {page_num} (size {page_size}): {result}")
