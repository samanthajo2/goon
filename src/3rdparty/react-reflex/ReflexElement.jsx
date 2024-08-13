///////////////////////////////////////////////////////////
// ReflexElement
// By Philippe Leefsma
// December 2016
//
///////////////////////////////////////////////////////////
import throttle from 'lodash.throttle'
import Measure from 'react-measure'
import PropTypes from 'prop-types'
import ReactDOM from 'react-dom'
import Browser from './Browser'
import React from 'react'

export default class ReflexElement extends React.Component {

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  static propTypes = {
    renderOnResizeRate: PropTypes.number,
    propagateDimensions: PropTypes.bool,
    renderOnResize: PropTypes.bool,
    resizeHeight: PropTypes.bool,
    resizeWidth: PropTypes.bool,
    className: PropTypes.string,
    rotateMode: PropTypes.number,
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  static defaultProps = {
    renderOnResize: Browser.isSafari(),
    propagateDimensions: false,
    renderOnResizeRate: 60,
    resizeHeight: true,
    resizeWidth: true,
    className: '',
    rotateMode: 0,
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  constructor (props) {

    super (props)

    this.onResize = this.onResize.bind(this)

    this.setStateThrottled = throttle((state) => {
      this.setState(state)
    }, this.props.renderOnResizeRate)

    this.state = {
      dimensions: {
        height: "100%",
        width: "100%"
      }
    }
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  async componentWillReceiveProps (props) {

    if (props.size !== this.props.size) {

      const directions = this.toArray(props.direction)

      for (let dir of directions) {

        await this.props.events.emit('element.size', {
          size: props.size,
          direction: dir,
          element: this
        })
      }
    }
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  toArray (obj) {

    return obj ? (Array.isArray(obj) ? obj : [obj]) : []
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  onResize (rect) {

    const {
      renderOnResize,
      resizeHeight,
      resizeWidth
    } = this.props

    if (renderOnResize) {

      const dim = {};
      if (true || resizeHeight) {
        dim.height = Math.floor(rect.bounds.height);
      }
      if (true || resizeWidth) {
        dim.width = Math.floor(rect.bounds.width);

      }
      this.setStateThrottled({
        dimensions: dim,
      })
    }
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  renderChildren () {

    if (this.props.propagateDimensions) {

      return React.Children.map(this.props.children, (child) => {

        const newProps = Object.assign({},
          child.props, {
            dimensions: this.state.dimensions
          })

        return React.cloneElement(child, newProps)
      })
    }

    return this.props.children
  }

  /////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////
  render () {

    const classNames = [
      'reflex-element',
      ...this.props.className.split(' ')
    ]

    const className = classNames.join(' ')

    const outerStyle = Object.assign({}, {
        flex: this.props.flex
      }, this.props.style)

    const innerStyle = {
      height: this.state.dimensions.height,
      width: this.state.dimensions.width
    }

    // Measure seems to be broken in relation to rotated 
    // elements? Although why?
    const rot90 = (this.props.rotateMode % 2) !== 0;
    if (rot90) {
      const temp = innerStyle.width;
      innerStyle.width = innerStyle.height;
      innerStyle.height = temp;
    }

    return (
      <Measure bounds onResize={this.onResize}>
        {
          ({ measureRef }) =>
          <div ref={measureRef} className={className} style={outerStyle}>
            <div style={innerStyle}>
              { this.renderChildren() }
            </div>
          </div>
        }
      </Measure>
    )
  }
}
