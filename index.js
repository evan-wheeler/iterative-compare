var Q = require( 'q' );

// You can swap out some of these dependencies.
var Deferred = Q.defer,
    all = Q.all,
    isPromise = Q.isPromiseAlike;

/**
 * Normalizes calls to different iterator interfaces. Convert returned values into promises if necessary.
 * @param iter The iterator.
 * @returns {*} A promise to be resolved to a next value.
 */
function callIter( iter ) {
    var result;

    if( typeof( iter ) === "function" ) result = iter();
    else if( typeof( iter.next ) === "function" ) result = iter.next();
    else throw new Error( "Iterator does not appear to be invokable" );

    if( !isPromise( result ) ) {
        // if it just returned a raw value, convert it into a resolved promise.
        var d = Deferred();
        d.resolve( result );
        result = d.promise;
    }

    return result;
}

/**
 * Default comparison function.
 * @param a First item
 * @param b Second item
 * @returns {number} -1, 0, 1
 */
function defaultCmp( a, b ) {
    return a === b ? 0 : ( a < b ? -1 : 1 );
}

/**
 * Returns an item to insert into the result list.  Both v1 and v2 will be supplied if the
 * result of comparison was 0.
 * @param v1 The first value (or null if there was no first value).
 * @param v2 The second value (or null if there was no second value).
 * @param cmpResult The result of the comparison function.
 * @returns {*} The value that will be added to the results.
 **/
function defaultExtract( v1, v2, cmpResult ) {
    if( v1 && v2 ) {
        // we can still do a deeper comparison here if needed.
        return { value: v1, exists: "both" };
    }
    else if( v1 ) {
        // we can still do a deeper comparison here if needed.
        return { value: v1, exists: "left" };
    }
    else if( v2 ) {
        // we can still do a deeper comparison here if needed.
        return { value: v2, exists: "right" };
    }
    throw new Error( "Invalid arguments passed to defaultExtract" );
}

/**
 * Object for performing a comparison of two iterators.  Accepts option for compareFn
 * to customize the comparison and extractFn to return a result based on the comparison.
 * Iterators should either be functions which return a promise or a value
 * for the next item or an object with a next() method, which returns a promise or a value.
 * @param options Override options.
 * @constructor
 */
var IterativeCompare = module.exports = function( options ) {
    options = options || {};

    this.compareFn = options.compareFn || defaultCmp;
    this.extractFn = options.extractFn || defaultExtract;

    this._deferred = null;
};

IterativeCompare.prototype = {

    /**
     * Starts the comparison
     * @param iter1 First iterator
     * @param iter2 Second iterator
     * @returns {promise} a promise which will be fulfilled with the differences.
     */
    compare: function( iter1, iter2 ) {

        if( this._deferred ) {
            // don't allow multiple compares.
            throw new Error( "Already comparing" );
        }

        this._iter1 = iter1;
        this._iter2 = iter2;
        this._results = [];

        this._deferred = Deferred();

        // start the comparison.
        this._stepBoth();

        return this._deferred.promise;
    },

    /**
     * Adds a result and updates the promise's progress.
     * @param v1 The left value.
     * @param v2 The right value.
     * @param cmpResult The result of the comparison or null if objects weren't compared.
     * @private
     */
    _addResult: function( v1, v2, cmpResult ) {

        if( cmpResult === 0 && v1 && v2 ) {
            // The comparison was equal -- pass both values to extract result.
            this._results.push( this.extractFn( v1, v2, cmpResult ) );
        }
        else if( cmpResult < 0 || !v2 ) {
            // Item from left list was not in right list.
            this._results.push( this.extractFn( v1, null, -1 ) );
        }
        else if( cmpResult > 0 || !v1 ) {
            // Item from right list was not in left list.
            this._results.push( this.extractFn( null, v2, 1 ) );
        }

        // notify about progress.
        this._deferred.notify( this._results );
    },

    /**
     * Compares two values. Advances both iterators if values are equal, or just the
     * lesser value if they are different.
     * @param val1 Value from the first iterator.
     * @param val2 Value from the second iterator.
     **/
    _compareValues: function( val1, val2 ) {
        var d = this._deferred;

        if( val1 && val2 ) {
            // we have two items to compare ...
            var cmp = this.compareFn( val1, val2 );

            // add the result.
            this._addResult( val1, val2, cmp );

            // next step.
            this._step( val1, val2, cmp );
        }
        else if( val1 ) {
            // advance left until end.
            this._addResult( val1, val2, null );
            this._stepLeft();
        }
        else if( val2 ) {
            // advance right until end.
            this._addResult( val1, val2, null );
            this._stepRight();
        }
        else {
            // both are at the end.
            d.resolve( this._results );
        }
    },

    /**
     * Selects the correct step given the last two values and compare result.
     * @param v1 First value.
     * @param v2 Second value.
     * @param cmp Result of comparison -- should be non-null.
     **/
    _step: function( v1, v2, cmp ) {
        if( cmp === 0 ) {
            this._stepBoth();
        }
        else if( cmp < 0 ) {
            this._stepLeft( v2 );
        }
        else {
            this._stepRight( v1 );
        }
    },

    /**
     * Steps the first iterator and then compares the value with the current right value.
     * @param rightVal Value from the second iterator.
     **/
    _stepLeft: function( rightVal ) {
        var self = this;
        callIter( this._iter1 ).then( function( v ) {
            self._compareValues( v, rightVal );
        } ).fail( function( err ) {
                self._deferred.reject( err );
            } );
    },

    /**
     * Steps the second iterator and then compares the value with the current left value.
     * @param leftVal The value from the first iterator.
     **/
    _stepRight: function( leftVal ) {
        var self = this;
        callIter( this._iter2 ).then( function( v ) {
            self._compareValues( leftVal, v );
        } ).fail( function( err ) {
                self._deferred.reject( err );
            } );
    },

    /**
     * Steps both iterators and then compares the results.
     **/
    _stepBoth: function() {
        var self = this;
        all( [ callIter( this._iter1 ), callIter( this._iter2 ) ] ).then( function( results ) {
            self._compareValues( results[0], results[1] );
        } ).fail( function( err ) {
                self._deferred.reject( err );
            } );
    }
};

